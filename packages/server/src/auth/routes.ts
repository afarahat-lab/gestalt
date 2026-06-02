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
import type { SamlProvider } from './providers/saml';
import type { OidcProvider } from './providers/oidc';
import type { WindowsKerberosProvider } from './providers/kerberos';

const log = createContextLogger({ module: 'auth:routes' });

/**
 * The dashboard's login view uses this to decide which provider
 * buttons to render. Public — exposes only the provider list (no
 * config secrets). Always includes `local` when local auth is
 * enabled per ADR-025 policy.
 */
async function buildProviderList(authManager: AuthManager): Promise<string[]> {
  return authManager.getEnabledProviders().map((p) => p.type);
}

/**
 * Wraps the `Fastify` request shape into the auth module's typed
 * `IncomingRequest` / `OutgoingResponse` so providers can stay
 * Fastify-agnostic.
 */
function toIncoming(request: { headers: Record<string, unknown>; query: unknown; body: unknown; url: string; method: string }): IncomingRequest {
  return {
    headers: request.headers as Record<string, string | string[] | undefined>,
    query: (request.query ?? {}) as Record<string, string | undefined>,
    body: request.body,
    url: request.url,
    method: request.method,
  };
}

const noopOutgoing: OutgoingResponse = {
  redirect: () => undefined,
  setCookie: () => undefined,
};

/**
 * Registers all auth routes on the Fastify instance.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  authManager: AuthManager,
): Promise<void> {

  // ─── Provider discovery (dashboard login renderer uses this) ──
  app.get('/auth/providers', async (_req, reply) => {
    const providers = await buildProviderList(authManager);
    return reply.send({ providers });
  });

  // ─── Kerberos / SPNEGO ─────────────────────────────────────────
  // GET /auth/kerberos
  //   no Authorization header → 401 WWW-Authenticate: Negotiate
  //   Authorization: Negotiate <token> → validate, issue JWT
  app.get('/auth/kerberos', async (request, reply) => {
    const provider = authManager.getProvider<WindowsKerberosProvider>('windows-kerberos');
    if (!provider) {
      return reply.code(404).send({ error: 'Kerberos provider not configured' });
    }
    const authHeader = request.headers['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('negotiate ')) {
      reply.header('WWW-Authenticate', 'Negotiate');
      return reply.code(401).send({ error: 'Kerberos negotiation required' });
    }
    try {
      const incoming = toIncoming(request);
      const { users } = getRepositories();
      const identity = await provider.authenticate(incoming, noopOutgoing);
      if (!identity) return reply.code(401).send({ error: 'Kerberos authentication failed' });
      const token = await authManager.createSessionFromIdentity(
        identity,
        async (u) => users.upsert(u) as Promise<PlatformUser>,
      );
      return reply.send({ token });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return reply.code(err.code === 'PROVIDER_ERROR' ? 500 : 401).send({ error: err.message, code: err.code });
      }
      log.error({ err }, 'Kerberos auth error');
      return reply.code(500).send({ error: 'Kerberos authentication failed' });
    }
  });

  // ─── SAML 2.0 ──────────────────────────────────────────────────
  app.get<{ Querystring: { relay?: string } }>(
    '/auth/saml/login',
    async (request, reply) => {
      const provider = authManager.getProvider<SamlProvider>('saml');
      if (!provider) return reply.code(404).send({ error: 'SAML provider not configured' });
      try {
        const url = await provider.getLoginUrl(request.query.relay);
        return reply.redirect(url);
      } catch (err) {
        log.error({ err }, 'SAML login URL generation failed');
        return reply.code(500).send({ error: 'SAML login URL generation failed' });
      }
    },
  );

  app.post('/auth/saml/callback', async (request, reply) => {
    const provider = authManager.getProvider<SamlProvider>('saml');
    if (!provider) return reply.code(404).send({ error: 'SAML provider not configured' });
    try {
      const incoming = toIncoming(request);
      const { users } = getRepositories();
      const identity = await provider.authenticate(incoming, noopOutgoing);
      if (!identity) return reply.code(401).send({ error: 'SAML assertion missing' });
      const token = await authManager.createSessionFromIdentity(
        identity,
        async (u) => users.upsert(u) as Promise<PlatformUser>,
      );
      // The dashboard SPA picks the token out of the URL on load and
      // stores it in localStorage. The 5-minute JWT TTL guards
      // against the token surviving in browser history beyond a
      // single navigation.
      const relay = (request.body as Record<string, string> | null)?.['RelayState'] ?? '/app/';
      return reply.redirect(`${relay}?token=${encodeURIComponent(token)}`);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return reply.code(401).send({ error: err.message, code: err.code });
      }
      log.error({ err }, 'SAML callback failed');
      return reply.code(500).send({ error: 'SAML callback failed' });
    }
  });

  app.get('/auth/saml/metadata', async (_req, reply) => {
    const provider = authManager.getProvider<SamlProvider>('saml');
    if (!provider) return reply.code(404).send({ error: 'SAML provider not configured' });
    reply.type('application/xml');
    return reply.send(provider.getMetadata());
  });

  // ─── OIDC ──────────────────────────────────────────────────────
  app.get('/auth/oidc/login', async (_request, reply) => {
    const provider = authManager.getProvider<OidcProvider>('oidc');
    if (!provider) return reply.code(404).send({ error: 'OIDC provider not configured' });
    try {
      const { url } = provider.getLoginUrl();
      return reply.redirect(url);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return reply.code(500).send({ error: err.message, code: err.code });
      }
      log.error({ err }, 'OIDC login URL generation failed');
      return reply.code(500).send({ error: 'OIDC login URL generation failed' });
    }
  });

  app.get('/auth/oidc/callback', async (request, reply) => {
    const provider = authManager.getProvider<OidcProvider>('oidc');
    if (!provider) return reply.code(404).send({ error: 'OIDC provider not configured' });
    try {
      const incoming = toIncoming(request);
      const { users } = getRepositories();
      const identity = await provider.authenticate(incoming, noopOutgoing);
      if (!identity) return reply.code(401).send({ error: 'OIDC callback missing code or state' });
      const token = await authManager.createSessionFromIdentity(
        identity,
        async (u) => users.upsert(u) as Promise<PlatformUser>,
      );
      return reply.redirect(`/app/?token=${encodeURIComponent(token)}`);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return reply.code(401).send({ error: err.message, code: err.code });
      }
      log.error({ err }, 'OIDC callback failed');
      return reply.code(500).send({ error: 'OIDC callback failed' });
    }
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
