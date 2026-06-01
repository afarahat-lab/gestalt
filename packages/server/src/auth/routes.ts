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
import { getRepositories, createContextLogger } from '@gestalt/core';
import { AuthenticationError, type AuthManager } from './auth-manager';
import type { IncomingRequest, OutgoingResponse, PlatformUser } from './types';

const log = createContextLogger({ module: 'auth:routes' });

/**
 * Registers all auth routes on the Fastify instance.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  authManager: AuthManager,
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
    async (request, reply) => {
      const { email, password } = request.body ?? ({} as { email?: string; password?: string });
      if (!email || !password) {
        return reply.code(400).send({ error: 'email and password are required' });
      }

      const incoming: IncomingRequest = {
        headers: request.headers as Record<string, string | string[] | undefined>,
        query: request.query as Record<string, string | undefined>,
        body: request.body,
        url: request.url,
        method: request.method,
      };
      // Local login never redirects or sets cookies; supply a no-op response.
      const outgoing: OutgoingResponse = {
        redirect: () => undefined,
        setCookie: () => undefined,
      };

      try {
        const { users } = getRepositories();
        const token = await authManager.authenticate(
          incoming,
          outgoing,
          async (u) => users.upsert(u) as Promise<PlatformUser>,
        );

        if (!token) {
          return reply.code(401).send({ error: 'No authentication provider could handle this request' });
        }

        // Return the freshly-issued token plus a small user summary so the
        // CLI/dashboard can render the signed-in state without a follow-up call.
        const credentialOwner = await users.findByIdpSubject(email.trim().toLowerCase(), 'local');
        return reply.send({
          token,
          user: credentialOwner && {
            id: credentialOwner.id,
            email: credentialOwner.email,
            displayName: credentialOwner.displayName,
            role: credentialOwner.role,
            authProvider: credentialOwner.authProvider,
          },
        });
      } catch (err) {
        if (err instanceof AuthenticationError) {
          const status =
            err.code === 'LOCAL_IN_PRODUCTION' || err.code === 'ACCESS_DENIED' ? 403 : 401;
          return reply.code(status).send({ error: err.message, code: err.code });
        }
        log.error({ err }, 'Unexpected error during local login');
        return reply.code(500).send({ error: 'Authentication failed' });
      }
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
