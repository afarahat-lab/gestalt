/**
 * OIDC authentication provider (ADR-024 priority 3).
 *
 * Acts as a Relying Party (RP). Used with Azure AD / Entra ID,
 * Okta, Auth0, Google Workspace SSO, and any OIDC-compliant IdP.
 *
 * Flow (authorization code with PKCE):
 *   1. Dashboard `Sign in with Azure AD (OIDC)` button hits
 *      `GET /auth/oidc/login` → server generates state + PKCE
 *      verifier, stores both keyed by state, redirects to the
 *      authorization endpoint
 *   2. User authenticates at the IdP
 *   3. IdP redirects to our callback:
 *      `GET /auth/oidc/callback?code=...&state=...`
 *   4. RP exchanges the code for tokens, validates the ID token,
 *      returns `VerifiedIdentity`
 *   5. Route layer issues a JWT and redirects to `/app/?token=<jwt>`
 *
 * Implementation: `openid-client` v5 — the reference OIDC RP
 * library. `Issuer.discover()` is a network call (fetches the
 * well-known config); we run it in `init()` at startup, not per
 * request.
 *
 * State + PKCE verifier are stored in an in-memory `Map` keyed by
 * the OAuth state nonce. Each entry expires after 10 minutes.
 * Production HA deployments (multiple server replicas) would need
 * Redis-backed state — flagged as a future enhancement; out of
 * scope for ADR-040's initial single-replica target.
 */

import { Issuer, generators } from 'openid-client';
import type { Client } from 'openid-client';
import type {
  AuthProvider, OidcConfig,
  VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from '../types';
import { AuthenticationError } from '../auth-manager';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'auth:oidc' });

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The wider config shape (post-ADR-040). The legacy `OidcConfig`
 * type has `scopes: string[]`; the file config carries
 * `groupsClaim` for the IdP claim that holds group memberships
 * (Azure AD uses `groups`; Okta uses `groups`; some IdPs use a
 * custom claim).
 */
interface OidcConfigExt extends OidcConfig {
  groupsClaim?: string;
}

export class OidcProvider implements AuthProvider {
  readonly type = 'oidc' as const;
  private client: Client | null = null;
  private clientError: string | null = null;
  private readonly stateStore = new Map<string, { codeVerifier: string; createdAt: number }>();

  constructor(private readonly config: OidcConfigExt) {}

  /**
   * One-time issuer discovery + client construction. Called from
   * `createAuthManager`. Failure is logged and swallowed so a
   * temporarily-unreachable IdP doesn't prevent the server from
   * starting — the provider's `authenticate` reports a clear error
   * on the first real request.
   */
  async init(): Promise<void> {
    try {
      const issuer = await Issuer.discover(this.config.issuer);
      this.client = new issuer.Client({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uris: [this.config.callbackUrl],
        response_types: ['code'],
      });
      log.info({ issuer: this.config.issuer }, 'OIDC issuer discovered');
    } catch (err) {
      this.clientError = (err as Error).message ?? String(err);
      log.error(
        { err: this.clientError, issuer: this.config.issuer },
        'OIDC issuer discovery failed — provider disabled until next restart',
      );
    }
  }

  /**
   * Called by AuthManager only on the callback path. The login URL
   * generation is handled directly by the `GET /auth/oidc/login`
   * route, which calls `getLoginUrl` below.
   */
  canHandle(req: IncomingRequest): boolean {
    if (req.method !== 'GET') return false;
    if (!req.url.includes('/auth/oidc/callback')) return false;
    return typeof req.query['code'] === 'string' &&
           typeof req.query['state'] === 'string';
  }

  async authenticate(
    req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    if (!this.client) {
      throw new AuthenticationError(
        `OIDC provider not initialised: ${this.clientError ?? 'unknown'}`,
        'PROVIDER_ERROR',
      );
    }

    const code = req.query['code'];
    const state = req.query['state'];
    if (typeof code !== 'string' || typeof state !== 'string') return null;

    const stored = this.stateStore.get(state);
    if (!stored) {
      throw new AuthenticationError(
        'OIDC state mismatch or expired',
        'INVALID_TOKEN',
      );
    }
    this.stateStore.delete(state);

    let tokenSet;
    try {
      tokenSet = await this.client.callback(
        this.config.callbackUrl,
        { code, state },
        { state, code_verifier: stored.codeVerifier },
      );
    } catch (err) {
      log.warn({ err }, 'OIDC callback exchange failed');
      throw new AuthenticationError(
        `OIDC callback exchange failed: ${(err as Error).message ?? String(err)}`,
        'INVALID_TOKEN',
      );
    }

    const claims = tokenSet.claims();
    const email = typeof claims['email'] === 'string' ? claims['email'] : '';
    if (!email) {
      throw new AuthenticationError(
        'OIDC ID token missing `email` claim',
        'INVALID_TOKEN',
      );
    }
    const displayName =
      (typeof claims['name'] === 'string' && claims['name']) ||
      (typeof claims['preferred_username'] === 'string' && claims['preferred_username']) ||
      email;
    const groupsClaimKey = this.config.groupsClaim ?? 'groups';
    const groups = extractGroups(claims[groupsClaimKey]);
    const subject = String(claims['sub']);

    return {
      subject,
      email: email.toLowerCase(),
      displayName,
      groups,
      provider: 'oidc',
    };
  }

  /**
   * Generates the authorization URL the browser is redirected to.
   * Stores state + PKCE verifier so the matching callback can be
   * verified. Cleans expired state entries opportunistically.
   */
  getLoginUrl(): { url: string; state: string } {
    if (!this.client) {
      throw new AuthenticationError(
        `OIDC provider not initialised: ${this.clientError ?? 'unknown'}`,
        'PROVIDER_ERROR',
      );
    }
    const state = generators.state();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    this.stateStore.set(state, { codeVerifier, createdAt: Date.now() });
    this.cleanExpired();

    const url = this.client.authorizationUrl({
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url, state };
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, val] of this.stateStore) {
      if (now - val.createdAt > STATE_TTL_MS) this.stateStore.delete(key);
    }
  }
}

function extractGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return [raw];
  return [];
}
