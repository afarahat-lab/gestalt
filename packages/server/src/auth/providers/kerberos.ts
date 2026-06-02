/**
 * Windows Kerberos / SPNEGO authentication provider.
 *
 * Enables seamless single sign-on for domain-joined Windows users.
 * Users on domain-joined machines are authenticated automatically via
 * their Windows login session — no username, no password, no redirect.
 *
 * Flow:
 *   1. Server sends `WWW-Authenticate: Negotiate` challenge
 *   2. Browser responds with `Authorization: Negotiate <SPNEGO token>`
 *   3. Server validates the Kerberos ticket against the AD/KDC
 *   4. User identity extracted from ticket (UPN)
 *   5. Platform JWT issued
 *
 * Prerequisites (one-time IT setup):
 *   - Server registered as SPN in Active Directory (ADR-027)
 *   - Service account keytab placed at `keytabPath` from auth.config.json
 *   - DNS A record for the SPN host pointing to the server
 *   - `KRB5_KTNAME` env var set to the keytab path before server start
 *     (some MIT Kerberos builds require this; the `kerberos` npm package
 *     respects the standard env var)
 *
 * The `kerberos` npm package has a native addon. It's listed in
 * `optionalDependencies` so a host where the native build fails (older
 * macOS without krb5-dev) still installs the platform — the provider
 * just refuses to load at runtime with a clear error.
 *
 * Group memberships are NOT fetched from the ticket alone — Kerberos
 * tickets carry the user identity but group lookups require an LDAP
 * query against the domain controller. The provider returns an empty
 * `groups` array; production deployments wire group lookup via an
 * optional LDAP query (out of scope for ADR-040).
 */

import type {
  AuthProvider, WindowsKerberosConfig,
  VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from '../types';
import { createContextLogger } from '@gestalt/core';
import { AuthenticationError } from '../auth-manager';

const log = createContextLogger({ module: 'auth:kerberos' });

// The `kerberos` npm package ships no types — declare the subset we
// touch so the dynamic import type-checks. The `// @ts-expect-error`
// at the dynamic-import call site below would be more concise but
// loses the typed surface for the call sites.
interface KerberosServerCtx {
  step(token: string, callback: (err: unknown, ctx: { response?: string; username?: string }) => void): void;
}

interface KerberosModule {
  initializeServer(spn: string, callback: (err: unknown, ctx: KerberosServerCtx) => void): void;
}

export class WindowsKerberosProvider implements AuthProvider {
  readonly type = 'windows-kerberos' as const;
  private kerberosModule: KerberosModule | null = null;
  private moduleLoadError: string | null = null;

  constructor(private readonly config: WindowsKerberosConfig) {}

  /**
   * Returns true when the request carries a Negotiate authorization
   * header — the browser is attempting Kerberos/NTLM SSO.
   */
  canHandle(req: IncomingRequest): boolean {
    const authHeader = req.headers['authorization'];
    return (
      typeof authHeader === 'string' &&
      authHeader.toLowerCase().startsWith('negotiate ')
    );
  }

  /**
   * Validates the SPNEGO token against the AD/KDC using the
   * configured SPN. The keytab is resolved via the `KRB5_KTNAME`
   * env var (operators set this in their docker-compose / systemd
   * unit; see auth.config.json `kerberos.keytabPath`).
   */
  async authenticate(
    req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('negotiate ')) {
      return null;
    }
    const token = authHeader.slice('Negotiate '.length);

    const kerberos = await this.loadModule();
    if (!kerberos) {
      throw new AuthenticationError(
        `Kerberos native module unavailable: ${this.moduleLoadError ?? 'unknown'}`,
        'PROVIDER_ERROR',
      );
    }

    let ctx: KerberosServerCtx;
    try {
      ctx = await new Promise<KerberosServerCtx>((resolve, reject) => {
        kerberos.initializeServer(this.config.spn, (err, c) =>
          err ? reject(err) : resolve(c),
        );
      });
    } catch (err) {
      log.error({ err, spn: this.config.spn }, 'Kerberos initializeServer failed');
      throw new AuthenticationError(
        `Kerberos context init failed: ${(err as Error).message ?? String(err)}`,
        'PROVIDER_ERROR',
      );
    }

    let result: { response?: string; username?: string };
    try {
      result = await new Promise((resolve, reject) => {
        ctx.step(token, (err, r) => (err ? reject(err) : resolve(r)));
      });
    } catch (err) {
      log.warn({ err }, 'Kerberos ticket validation failed');
      throw new AuthenticationError(
        `Kerberos token validation failed: ${(err as Error).message ?? String(err)}`,
        'INVALID_TOKEN',
      );
    }

    if (!result.username) {
      // NTLM negotiation may take multiple round-trips. The current
      // implementation doesn't carry state between requests — operators
      // disable NTLM fallback in AD policy (recommended anyway for
      // security). Clean Kerberos tickets complete in a single round-
      // trip with `username` populated.
      throw new AuthenticationError(
        'Kerberos ticket did not yield a username (NTLM fallback not supported)',
        'INVALID_TOKEN',
      );
    }

    const upn = normaliseUpn(result.username, this.config.realm);
    const email = upn.toLowerCase();

    return {
      subject: result.username,
      email,
      displayName: upn,
      groups: [],  // LDAP lookup needed for group membership; out of scope for ADR-040
      provider: 'windows-kerberos',
    };
  }

  private async loadModule(): Promise<KerberosModule | null> {
    if (this.kerberosModule) return this.kerberosModule;
    if (this.moduleLoadError !== null) return null;
    try {
      // Dynamic import so a missing native addon doesn't crash the
      // server at startup — the operator sees a clear error only when
      // a Kerberos request actually arrives. The package ships no
      // types — cast the result via `unknown` to the typed shape
      // declared at the top of this module.
      // @ts-expect-error — no types for the `kerberos` package
      const mod = await import('kerberos');
      this.kerberosModule = (mod as unknown as { default?: KerberosModule }).default ?? (mod as unknown as KerberosModule);
      return this.kerberosModule;
    } catch (err) {
      this.moduleLoadError = (err as Error).message ?? String(err);
      log.error(
        { err: this.moduleLoadError },
        'Failed to load `kerberos` native module — provider disabled',
      );
      return null;
    }
  }
}

/**
 * Normalises the various forms the `kerberos` module may emit:
 *   - `user@REALM.COM`         → return as-is
 *   - `user@realm.com`         → return as-is
 *   - `DOMAIN\\user`           → `user@<config-realm>`
 *   - `user` (no realm)        → `user@<config-realm>`
 */
function normaliseUpn(raw: string, configRealm: string): string {
  if (raw.includes('@')) return raw;
  if (raw.includes('\\')) {
    const parts = raw.split('\\');
    return `${parts[1]}@${configRealm}`;
  }
  return `${raw}@${configRealm}`;
}

/**
 * Returns headers carrying the SPNEGO challenge for the browser to
 * react to. The route layer uses this to respond 401 with the
 * `WWW-Authenticate` header populated.
 */
export function sendNegotiateChallenge(
  headers: Record<string, string>,
): Record<string, string> {
  return { ...headers, 'WWW-Authenticate': 'Negotiate' };
}
