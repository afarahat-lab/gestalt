/**
 * Authentication routes.
 *
 * Routes:
 *   GET  /auth/saml/login      — redirect to SAML IdP
 *   POST /auth/saml/callback   — SAML assertion callback
 *   GET  /auth/saml/metadata   — SP metadata XML (give to IT for IdP config)
 *   GET  /auth/oidc/login      — redirect to OIDC provider
 *   GET  /auth/oidc/callback   — OIDC authorization code callback
 *   POST /auth/login           — local fallback login
 *   GET  /auth/me              — current user info
 *   POST /auth/logout          — invalidate session
 *
 * All successful auth flows redirect to the dashboard root with a token
 * in a short-lived cookie or query param that the SPA picks up on load.
 *
 * Full implementation: Phase 2.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthManager } from './auth-manager';

/**
 * Registers all auth routes on the Fastify instance.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  _authManager: AuthManager,
): Promise<void> {

  // SAML flow
  app.get('/auth/saml/login', async (_req, _reply) => {
    throw new Error('GET /auth/saml/login not yet implemented');
    // Phase 2: redirect to IdP with SAMLRequest
  });

  app.post('/auth/saml/callback', async (_req, _reply) => {
    throw new Error('POST /auth/saml/callback not yet implemented');
    // Phase 2: validate assertion, create session, redirect to dashboard
  });

  app.get('/auth/saml/metadata', async (_req, reply) => {
    // Phase 2: generate and return SP metadata XML
    // IT uses this to configure the IdP
    reply.type('application/xml');
    throw new Error('GET /auth/saml/metadata not yet implemented');
  });

  // OIDC flow
  app.get('/auth/oidc/login', async (_req, _reply) => {
    throw new Error('GET /auth/oidc/login not yet implemented');
    // Phase 2: redirect to OIDC provider with authorization request
  });

  app.get('/auth/oidc/callback', async (_req, _reply) => {
    throw new Error('GET /auth/oidc/callback not yet implemented');
    // Phase 2: exchange code for tokens, validate, create session
  });

  // Local fallback login
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    async (_req, _reply) => {
      throw new Error('POST /auth/login not yet implemented');
      // Phase 2:
      // 1. Check NODE_ENV — if production and !allowedInProduction, reject with 403
      // 2. Look up user by email
      // 3. bcrypt.compare(password, user.passwordHash)
      // 4. Issue JWT
      // 5. Return { token, user }
    },
  );

  // Current user
  app.get('/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Not authenticated' });
    return reply.send({
      id: req.user.id,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.role,
      authProvider: req.user.authProvider,
    });
  });

  // Logout
  app.post('/auth/logout', async (_req, reply) => {
    // JWT is stateless — logout is client-side token deletion
    // Phase 2: optionally maintain a token blocklist for immediate invalidation
    return reply.send({ loggedOut: true });
  });
}
