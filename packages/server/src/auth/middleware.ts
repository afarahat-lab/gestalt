/**
 * Fastify authentication middleware.
 *
 * Applied to all protected routes. Validates the JWT from the Authorization
 * header or SSE query param, attaches the user to the request context.
 *
 * Public routes (no auth required):
 *   GET  /health
 *   POST /auth/login        (local fallback login)
 *   GET  /auth/saml/login   (SAML redirect)
 *   POST /auth/saml/callback
 *   GET  /auth/oidc/login   (OIDC redirect)
 *   GET  /auth/oidc/callback
 *   GET  /auth/saml/metadata
 *
 * All other routes require a valid JWT.
 *
 * Role-gated routes:
 *   POST /interventions      — operator+
 *   POST /maintenance/trigger — operator+
 *   DELETE/admin routes      — admin only
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { PlatformUser, UserRole } from './types';
import { verifyToken, extractToken } from './session';
import { hasPermission } from './role-mapper';
import type { SessionConfig } from './session';

// Extend Fastify request type to include authenticated user
declare module 'fastify' {
  interface FastifyRequest {
    user?: PlatformUser;
  }
}

const PUBLIC_ROUTES = new Set([
  'GET /health',
  'POST /auth/login',
  'GET /auth/saml/login',
  'POST /auth/saml/callback',
  'GET /auth/oidc/login',
  'GET /auth/oidc/callback',
  'GET /auth/saml/metadata',
  'GET /events',  // SSE — token passed as query param, handled inside route
]);

/**
 * Registers the authentication prehandler on the Fastify instance.
 * Phase 2: full implementation.
 */
export async function registerAuthMiddleware(
  app: FastifyInstance,
  sessionConfig: SessionConfig,
  getUserById: (id: string) => Promise<PlatformUser | null>,
): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeKey = `${request.method} ${request.routerPath}`;
    if (PUBLIC_ROUTES.has(routeKey)) return;

    const token = extractToken(request.headers as Record<string, string | undefined>)
      ?? (request.query as Record<string, string>)['token'];

    if (!token) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const payload = verifyToken(token, sessionConfig);
      const user = await getUserById(payload.sub);

      if (!user) {
        return reply.code(401).send({ error: 'User not found' });
      }

      request.user = user;
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
}

/**
 * Returns a Fastify preHandler that enforces a minimum role requirement.
 * Usage: app.post('/admin/users', { preHandler: requireRole('admin') }, handler)
 */
export function requireRole(minimumRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!hasPermission(request.user.role, minimumRole)) {
      return reply.code(403).send({
        error: `Insufficient permissions. Required: ${minimumRole}. Your role: ${request.user.role}`,
      });
    }
  };
}
