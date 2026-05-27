/**
 * Identity and authentication types for AgentForge SDLC.
 * Covers all three auth modes: Windows Kerberos, IdP (SAML/OIDC), and local fallback.
 */

// ─── Auth provider types ──────────────────────────────────────────────────────

export type AuthProviderType = 'windows-kerberos' | 'saml' | 'oidc' | 'local';

export type UserRole = 'admin' | 'operator' | 'viewer';

// ─── Provider configs ─────────────────────────────────────────────────────────

export interface WindowsKerberosConfig {
  type: 'windows-kerberos';
  enabled: boolean;
  spn: string;            // Service Principal Name e.g. HTTP/agentforge.company.com
  realm: string;          // Kerberos realm e.g. COMPANY.COM
  kdcHostname: string;    // Key Distribution Center hostname
}

export interface SamlConfig {
  type: 'saml';
  enabled: boolean;
  entryPoint: string;     // IdP SSO URL
  issuer: string;         // SP entity ID (our identifier to the IdP)
  cert: string;           // IdP signing certificate (PEM)
  callbackUrl: string;    // Our ACS URL e.g. https://agentforge.company.com/auth/saml/callback
}

export interface OidcConfig {
  type: 'oidc';
  enabled: boolean;
  issuer: string;         // e.g. https://login.microsoftonline.com/{tenant}/v2.0
  clientId: string;
  clientSecret: string;
  callbackUrl: string;    // Our redirect URI
  scopes: string[];       // e.g. ['openid', 'profile', 'email', 'groups']
}

export interface LocalAuthConfig {
  type: 'local';
  enabled: boolean;
  warningBanner: boolean;       // show non-production warning in dashboard
  allowedInProduction: boolean; // always false — enforced in code, not just config
}

export type AuthProviderConfig =
  | WindowsKerberosConfig
  | SamlConfig
  | OidcConfig
  | LocalAuthConfig;

// ─── Role mapping ─────────────────────────────────────────────────────────────

export interface RoleMapping {
  idpGroup: string;       // group name from IdP claims
  platformRole: UserRole;
}

// ─── Identity config (full, from HARNESS.json) ───────────────────────────────

export interface IdentityConfig {
  providers: AuthProviderConfig[];
  roleMapping: RoleMapping[];
  defaultRole: UserRole | null;   // null = deny if no group match
  sessionTtlMinutes: number;
}

// ─── Platform user ────────────────────────────────────────────────────────────

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  authProvider: AuthProviderType;
  idpSubject: string;       // IdP's unique identifier (NameID / sub / username)
  idpGroups: string[];      // raw groups from IdP — stored for role re-evaluation
  lastLoginAt: Date;
  createdAt: Date;
}

// ─── Verified identity (output of any auth provider) ─────────────────────────

/**
 * Normalised identity claims extracted from any auth provider.
 * Every provider produces this — downstream code never knows which provider was used.
 */
export interface VerifiedIdentity {
  subject: string;          // unique identifier from the provider
  email: string;
  displayName: string;
  groups: string[];         // group memberships for role mapping
  provider: AuthProviderType;
}

// ─── Auth provider interface ──────────────────────────────────────────────────

export interface AuthProvider {
  readonly type: AuthProviderType;

  /**
   * Determines if this provider should handle the current request.
   * Called in priority order: Kerberos → SAML/OIDC → local.
   */
  canHandle(req: IncomingRequest): boolean;

  /**
   * Attempts to authenticate the request.
   * Returns VerifiedIdentity on success, null if the provider cannot authenticate.
   * Throws on authentication failure (wrong credentials, invalid token, etc.)
   */
  authenticate(req: IncomingRequest, res: OutgoingResponse): Promise<VerifiedIdentity | null>;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface PlatformSession {
  token: string;            // JWT issued by the server
  user: PlatformUser;
  expiresAt: Date;
}

// ─── Minimal request/response types ──────────────────────────────────────────
// Thin wrappers so auth modules don't depend on Fastify directly

export interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  url: string;
  method: string;
}

export interface OutgoingResponse {
  redirect(url: string): void;
  setCookie(name: string, value: string, options?: Record<string, unknown>): void;
}
