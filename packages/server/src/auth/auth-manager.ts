/**
 * Auth manager — orchestrates authentication across all configured providers.
 *
 * Priority order (fixed):
 *   1. Windows Kerberos (SPNEGO) — if browser sends Negotiate header
 *   2. SAML / OIDC — if IdP is configured and no SPNEGO header
 *   3. Local fallback — only if explicitly enabled, no IdP available
 *
 * The auth manager:
 *   - Selects the correct provider for each request
 *   - Calls provider.authenticate()
 *   - Maps the resulting VerifiedIdentity to a platform role
 *   - Creates or updates the local PlatformUser shadow record
 *   - Issues a JWT session token
 *
 * This is the only module that knows about multiple providers.
 * Everything else sees only PlatformUser and UserRole.
 */

import type {
  AuthProvider, IdentityConfig,
  PlatformUser, UserRole, VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from './types';
import { getRepositories } from '@gestalt/core';
import { resolveRole, isDenied } from './role-mapper';
import { issueToken } from './session';
import type { SessionConfig } from './session';

export class AuthManager {
  private providers: AuthProvider[] = [];

  constructor(
    private readonly identityConfig: IdentityConfig,
    private readonly sessionConfig: SessionConfig,
  ) {}

  /**
   * Registers auth providers in priority order.
   * Called at server startup after providers are instantiated.
   */
  registerProvider(provider: AuthProvider): void {
    this.providers.push(provider);
  }

  /**
   * Attempts to authenticate a request using the first matching provider.
   * Returns a JWT token on success.
   * Throws AuthenticationError on failure.
   * Returns null if no provider can handle the request (unauthenticated).
   */
  async authenticate(
    req: IncomingRequest,
    res: OutgoingResponse,
    upsertUser: (user: Omit<PlatformUser, 'id' | 'createdAt' | 'deactivatedAt'>) => Promise<PlatformUser>,
  ): Promise<string | null> {
    // Find the first provider that can handle this request
    const provider = this.providers.find((p) => p.canHandle(req));
    if (!provider) return null;

    const identity = await provider.authenticate(req, res);
    if (!identity) return null;

    return this.createSession(identity, upsertUser);
  }

  /**
   * Creates a platform session from a verified identity.
   * Resolves role, upserts the shadow user record, issues JWT.
   *
   * For local-provider identities the existing user's role is preserved
   * (the admin role granted at first-boot setup must survive subsequent
   * logins). IdP-provided identities have their role re-evaluated from
   * groups on every login.
   */
  private async createSession(
    identity: VerifiedIdentity,
    upsertUser: (user: Omit<PlatformUser, 'id' | 'createdAt' | 'deactivatedAt'>) => Promise<PlatformUser>,
  ): Promise<string> {
    let role: UserRole;

    if (identity.provider === 'local') {
      const { users } = getRepositories();
      const existing = await users.findByIdpSubject(identity.subject, 'local');
      // Preserve the stored role on every login. The first-boot admin
      // setup wrote `platform-admin`; subsequent locally-created users
      // default to `user` (set by `POST /users` or by this fallback
      // for legacy paths that didn't specify a role).
      role = (existing?.role as UserRole | undefined) ?? 'user';
    } else {
      const roleResult = resolveRole(
        identity,
        this.identityConfig.roleMapping,
        this.identityConfig.defaultRole,
      );

      if (isDenied(roleResult)) {
        throw new AuthenticationError(roleResult.reason, 'ACCESS_DENIED');
      }

      role = roleResult.role;
    }

    const user = await upsertUser({
      email: identity.email,
      displayName: identity.displayName,
      role,
      authProvider: identity.provider,
      idpSubject: identity.subject,
      idpGroups: identity.groups,
      lastLoginAt: new Date(),
    });

    return issueToken(user, this.sessionConfig);
  }

  /**
   * Returns the enabled providers in priority order.
   * Used by the init wizard to validate provider configuration.
   */
  getEnabledProviders(): AuthProvider[] {
    return this.providers;
  }

  /**
   * Looks up the typed provider by its `type` string. The route
   * layer uses this to call provider-specific entry points
   * (`SamlProvider.getLoginUrl`, `SamlProvider.getMetadata`,
   * `OidcProvider.getLoginUrl`) without leaking provider classes
   * out of the auth module. Returns `null` when the provider
   * isn't configured.
   */
  getProvider<T extends AuthProvider = AuthProvider>(type: AuthProvider['type']): T | null {
    return (this.providers.find((p) => p.type === type) as T | undefined) ?? null;
  }

  /**
   * Convenience for the route layer to upsert a user after a
   * provider-driven flow (SAML / OIDC callback handlers). Wraps
   * `createSession` so the route can stay generic over provider.
   */
  async createSessionFromIdentity(
    identity: VerifiedIdentity,
    upsertUser: (user: Omit<PlatformUser, 'id' | 'createdAt' | 'deactivatedAt'>) => Promise<PlatformUser>,
  ): Promise<string> {
    return this.createSession(identity, upsertUser);
  }

  /**
   * Atomically replace the provider registry. Used by
   * `reinitAuth(authManager)` after a `PATCH /platform/identity/:provider`
   * so config changes take effect without restarting the server.
   * The swap is synchronous — in-flight requests using the old
   * provider list complete with the old list (`authenticate` reads
   * `this.providers` at call time, which is fine since both arrays
   * are immutable from the consumer's perspective).
   */
  swapProviders(providers: AuthProvider[]): void {
    this.providers = providers;
  }

  /** Read the identity config the manager was constructed with. */
  getIdentityConfig(): IdentityConfig {
    return this.identityConfig;
  }

  /** Return the list of provider types currently registered. */
  getActiveProviderTypes(): string[] {
    return this.providers.map((p) => p.type);
  }
}

/**
 * Re-reads the identity config from the database and rebuilds the
 * provider list, then atomically swaps it onto the AuthManager. The
 * AuthManager's `swapProviders` semantics mean in-flight requests
 * complete safely against whichever list was current when they
 * called `authenticate`.
 *
 * Returns the list of active provider types after the reload so the
 * route can surface them to the operator.
 */
export async function reinitAuth(
  manager: AuthManager,
  loadIdentityConfig: () => Promise<IdentityConfig>,
): Promise<string[]> {
  const identityConfig = await loadIdentityConfig();
  const providers = await instantiateProviders(identityConfig);
  manager.swapProviders(providers);
  return providers.map((p) => p.type);
}

async function instantiateProviders(identityConfig: IdentityConfig): Promise<AuthProvider[]> {
  const providers: AuthProvider[] = [];
  for (const providerConfig of identityConfig.providers) {
    if (!providerConfig.enabled) continue;
    switch (providerConfig.type) {
      case 'windows-kerberos': {
        const { WindowsKerberosProvider } = await import('./providers/kerberos.js');
        providers.push(new WindowsKerberosProvider(providerConfig));
        break;
      }
      case 'saml': {
        const { SamlProvider } = await import('./providers/saml.js');
        providers.push(new SamlProvider(providerConfig));
        break;
      }
      case 'oidc': {
        const { OidcProvider } = await import('./providers/oidc.js');
        const oidc = new OidcProvider(providerConfig);
        await oidc.init();
        providers.push(oidc);
        break;
      }
      case 'local': {
        if (process.env['NODE_ENV'] === 'production' && !providerConfig.allowedInProduction) {
          break;
        }
        const { LocalProvider } = await import('./providers/local.js');
        providers.push(new LocalProvider(providerConfig));
        break;
      }
    }
  }
  return providers;
}

// ─── Auth errors ──────────────────────────────────────────────────────────────

export type AuthErrorCode =
  | 'ACCESS_DENIED'         // authenticated but no role assigned
  | 'INVALID_TOKEN'         // token validation failed
  | 'PROVIDER_ERROR'        // provider-specific error
  | 'LOCAL_IN_PRODUCTION';  // local auth attempted in production

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: AuthErrorCode,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Builds and configures the AuthManager from HARNESS.json identity config.
 * Instantiates only the enabled providers.
 * Phase 2: full provider instantiation.
 */
export async function createAuthManager(
  identityConfig: IdentityConfig,
  sessionConfig: SessionConfig,
): Promise<AuthManager> {
  const manager = new AuthManager(identityConfig, sessionConfig);

  for (const providerConfig of identityConfig.providers) {
    if (!providerConfig.enabled) continue;

    switch (providerConfig.type) {
      case 'windows-kerberos': {
        const { WindowsKerberosProvider } = await import('./providers/kerberos.js');
        manager.registerProvider(new WindowsKerberosProvider(providerConfig));
        break;
      }
      case 'saml': {
        const { SamlProvider } = await import('./providers/saml.js');
        manager.registerProvider(new SamlProvider(providerConfig));
        break;
      }
      case 'oidc': {
        const { OidcProvider } = await import('./providers/oidc.js');
        const oidc = new OidcProvider(providerConfig);
        // Issuer discovery is a one-time network call. Failure is
        // logged inside `init()` but doesn't prevent the server from
        // starting — the provider's `authenticate` reports the error
        // on the first real request.
        await oidc.init();
        manager.registerProvider(oidc);
        break;
      }
      case 'local': {
        // Hard safety check — local auth never runs in production
        if (process.env['NODE_ENV'] === 'production' && !providerConfig.allowedInProduction) {
          console.warn(
            '[AUTH] Local auth provider is enabled but NODE_ENV=production. ' +
            'Local auth will not be registered. Set allowedInProduction: true to override (not recommended).',
          );
          break;
        }
        const { LocalProvider } = await import('./providers/local.js');
        manager.registerProvider(new LocalProvider(providerConfig));
        break;
      }
    }
  }

  return manager;
}
