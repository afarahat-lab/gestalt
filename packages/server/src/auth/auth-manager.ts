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
  AuthProvider, AuthProviderConfig, IdentityConfig,
  PlatformUser, VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from './types';
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
    upsertUser: (user: Omit<PlatformUser, 'id' | 'createdAt'>) => Promise<PlatformUser>,
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
   */
  private async createSession(
    identity: VerifiedIdentity,
    upsertUser: (user: Omit<PlatformUser, 'id' | 'createdAt'>) => Promise<PlatformUser>,
  ): Promise<string> {
    const roleResult = resolveRole(
      identity,
      this.identityConfig.roleMapping,
      this.identityConfig.defaultRole,
    );

    if (isDenied(roleResult)) {
      throw new AuthenticationError(roleResult.reason, 'ACCESS_DENIED');
    }

    const user = await upsertUser({
      email: identity.email,
      displayName: identity.displayName,
      role: roleResult.role,
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
        const { WindowsKerberosProvider } = await import('./providers/kerberos');
        manager.registerProvider(new WindowsKerberosProvider(providerConfig));
        break;
      }
      case 'saml': {
        const { SamlProvider } = await import('./providers/saml');
        manager.registerProvider(new SamlProvider(providerConfig));
        break;
      }
      case 'oidc': {
        const { OidcProvider } = await import('./providers/oidc');
        manager.registerProvider(new OidcProvider(providerConfig));
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
        const { LocalProvider } = await import('./providers/local');
        manager.registerProvider(new LocalProvider(providerConfig));
        break;
      }
    }
  }

  return manager;
}
