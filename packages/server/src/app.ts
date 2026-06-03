/**
 * Fastify application factory.
 *
 * Creates and configures the Fastify instance with:
 *   - Correlation ID hook (every request)
 *   - Auth middleware (JWT validation + RBAC)
 *   - Audit hook (GP-002 — all non-GET 2xx responses)
 *   - All route plugins
 *   - Static dashboard serving
 *   - Error handling
 */

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import corsPlugin from '@fastify/cors';
import formbodyPlugin from '@fastify/formbody';
import { join } from 'path';
import type { GestaltConfig } from '@gestalt/core';
import { createContextLogger } from '@gestalt/core';
import { registerAuthMiddleware } from './auth/middleware';
import { registerAuthRoutes } from './auth/routes';
import { registerAdminRoutes } from './routes/admin';
import { registerIntentRoutes } from './routes/intents';
import { registerProjectRoutes } from './routes/projects';
import { registerAgentRoutes } from './routes/agents';
import { registerExecutionRoutes } from './routes/executions';
import { registerDeploymentRoutes } from './routes/deployments';
import { registerMaintenanceRoutes } from './routes/maintenance';
import { registerStatusRoutes } from './routes/status';
import { registerEventsRoute } from './routes/events';
import { registerOversightRoutes } from './oversight/routes';
import { registerUserRoutes } from './routes/users';
import { registerMembershipRoutes } from './routes/memberships';
import { registerInterventionRoutes } from './routes/interventions';
import { registerProjectConfigRoutes } from './routes/project-config';
import { correlationHook } from './middleware/correlation';
import { auditHook } from './middleware/audit';
import type { AuthManager } from './auth/auth-manager';

const log = createContextLogger({ module: 'app' });

export async function createApp(
  config: GestaltConfig,
  authManager: AuthManager,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: false,  // We use our own pino logger
    trustProxy: true,
    requestIdHeader: 'x-correlation-id',
    genReqId: () => crypto.randomUUID(),
  });

  // ─── Global hooks ──────────────────────────────────────────────────────────

  app.addHook('onRequest', correlationHook);
  app.addHook('onResponse', auditHook);

  // ─── Plugins ───────────────────────────────────────────────────────────────

  // CORS — restrict to server's own origin in production
  await app.register(corsPlugin, {
    origin: config.server.nodeEnv === 'production'
      ? config.server.baseUrl
      : true,
    credentials: true,
  });

  // application/x-www-form-urlencoded parser — needed for the SAML
  // assertion POST callback (IdP submits the SAMLResponse via a
  // standard browser form). Fastify only parses JSON out of the
  // box; without this the SAML ACS endpoint returns 415.
  await app.register(formbodyPlugin);

  // ─── Auth middleware ────────────────────────────────────────────────────────

  const sessionConfig = {
    jwtSecret: config.auth.jwtSecret,
    sessionTtlMinutes: config.auth.sessionTtlMinutes,
  };

  await registerAuthMiddleware(app, sessionConfig);

  // ─── Routes ────────────────────────────────────────────────────────────────

  await registerStatusRoutes(app);
  await registerAuthRoutes(app, authManager);
  await registerAdminRoutes(app, sessionConfig);
  await registerIntentRoutes(app);
  await registerProjectRoutes(app);
  await registerAgentRoutes(app);
  await registerExecutionRoutes(app);
  await registerDeploymentRoutes(app);
  await registerMaintenanceRoutes(app);
  await registerEventsRoute(app, sessionConfig);
  await registerOversightRoutes(app);
  await registerUserRoutes(app);
  await registerMembershipRoutes(app);
  await registerInterventionRoutes(app);
  await registerProjectConfigRoutes(app);

  // ─── Dashboard static files ────────────────────────────────────────────────
  //
  // The SPA lives at /app/* so its routes never collide with API paths
  // (the previous /intents/:id and /alerts collisions made deep-linking
  // from the dashboard impossible — pasting a copied URL into a new tab
  // hit the API and returned JSON). Now:
  //
  //   /app/                    → dashboard index.html (Vite-built bundle)
  //   /app/assets/<hash>.{js,css} → fastify-static serves the bundle
  //   /app/intents/:id, /app/login, /app/agents, … → SPA fallback serves
  //                              index.html; React Router takes over
  //   /                        → 302 redirect to /app/ (so `gestalt
  //                              dashboard` users can still type the
  //                              bare URL and land in the right place)
  //   anything else            → either a registered API route, or 404
  //
  // fastify-static is mounted with `prefix: '/app'`. The not-found
  // handler is the SPA fallback ONLY for `/app/*` GETs; everything else
  // falls through to the API's 404. `decorateReply` must stay at the
  // default (true) so `reply.sendFile()` is available to the fallback.

  const dashboardDist = join(__dirname, '..', '..', 'dashboard', 'dist');
  try {
    await app.register(staticPlugin, {
      root: dashboardDist,
      prefix: '/app/',
    });

    // Convenience redirect — `gestalt dashboard` opens `<serverUrl>/app/`
    // directly, but a human typing the bare URL into the address bar
    // shouldn't get an opaque 401 from the API. 302 takes them to the
    // SPA root.
    app.get('/', async (_request, reply) => {
      return reply.redirect(302, '/app/');
    });

    // SPA fallback. Three branches:
    //  - GET under /app/* that didn't match a real file → serve
    //    index.html so React Router can render the right view
    //    (`/app/login`, `/app/intents/:id`, etc.)
    //  - Non-GET to anywhere unknown → 404 JSON (a stray write should
    //    never silently land in the SPA bucket)
    //  - GET to anywhere outside /app/* that isn't an API route → 404
    //    JSON (a typo at `/intnts` should fail loudly, not serve an
    //    `index.html` whose asset refs point at /app/assets and so
    //    silently break in the browser)
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET') {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (request.url.startsWith('/app/') || request.url === '/app') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  } catch {
    log.warn('Dashboard dist not found — serving API only. Run `pnpm build` in dashboard package.');
  }

  // ─── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error, request, reply) => {
    log.error(
      { err: error, correlationId: request.correlationId, url: request.url },
      'Unhandled error',
    );

    if (error.statusCode) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    return reply.code(500).send({ error: 'Internal server error' });
  });

  return app;
}
