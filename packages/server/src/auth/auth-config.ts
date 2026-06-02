/**
 * Corporate identity configuration loader (ADR-040).
 *
 * Reads an OPTIONAL `auth.config.json` from one of two locations:
 *   1. `process.cwd()/auth.config.json` (dev / docker-compose bind mount)
 *   2. `/etc/gestalt/auth.config.json` (production volume mount)
 *
 * The file is optional — when absent, returns null and the legacy
 * `HARNESS.json` identity block applies (config-loader.ts handles
 * that fallback path), ultimately defaulting to local-only auth per
 * ADR-025.
 *
 * The file's friendly object-keyed shape is translated into the
 * existing `IdentityConfig` (array-of-providers) so the AuthManager
 * and the rest of the auth stack don't need to know about the new
 * config source.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { createContextLogger } from '@gestalt/core';
import type {
  IdentityConfig, AuthProviderConfig, RoleMapping, UserRole,
} from './types';

const log = createContextLogger({ module: 'auth-config' });

// ─── On-disk shape (per ADR-040) ────────────────────────────────────────────

export interface KerberosFileConfig {
  enabled: boolean;
  realm: string;
  serviceAccount: string;
  keytabPath: string;
}

export interface SamlFileConfig {
  enabled: boolean;
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
  wantAssertionsSigned?: boolean;
  identifierFormat?: string;
  attributeMapping: {
    email: string;
    displayName: string;
    groups?: string;
  };
}

export interface OidcFileConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  groupsClaim?: string;
}

export interface AuthFileConfig {
  providers: {
    kerberos?: KerberosFileConfig;
    saml?: SamlFileConfig;
    oidc?: OidcFileConfig;
  };
  roleMapping: {
    platformAdmin: string[];
    defaultRole?: UserRole;
  };
  sessionTtlMinutes?: number;
}

/**
 * Searches the conventional auth.config.json paths. Returns null
 * when no file is found — callers fall back to the legacy
 * HARNESS.json identity path or the local-only default.
 */
export async function loadAuthConfigFile(): Promise<AuthFileConfig | null> {
  const candidates = [
    join(process.cwd(), 'auth.config.json'),
    '/etc/gestalt/auth.config.json',
  ];
  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as AuthFileConfig;
      log.info({ path }, 'Loaded auth.config.json');
      return parsed;
    } catch (err) {
      // Try next candidate; only the last failure is logged.
      log.debug({ path, err: (err as Error).message }, 'auth.config.json candidate not readable');
    }
  }
  return null;
}

/**
 * Translates the file's friendly shape into the existing
 * `IdentityConfig` so AuthManager (which is auth-mode agnostic)
 * doesn't need to learn the new source. Also stores the raw
 * `platformAdmin` group list as discrete `RoleMapping[]` entries.
 *
 * Provider-extension fields that don't fit the legacy
 * `AuthProviderConfig` shape (`callbackUrl`, `attributeMapping`,
 * `groupsClaim`, `scope`, etc.) are passed through via the same
 * objects — the legacy types' fields are a subset; provider
 * implementations read the wider object directly via the file
 * config (the loaders re-attach the wider config to the provider
 * instance, see `createAuthManager`).
 */
export function toIdentityConfig(file: AuthFileConfig): IdentityConfig {
  const providers: AuthProviderConfig[] = [];

  if (file.providers.kerberos?.enabled) {
    const k = file.providers.kerberos;
    providers.push({
      type: 'windows-kerberos',
      enabled: true,
      spn: k.serviceAccount,
      realm: k.realm,
      // Kerberos KDC discovery is delegated to the OS resolver
      // (krb5.conf in the keytab dir). Required by the legacy type
      // but not used by the provider — empty string is the explicit
      // "use OS default" sentinel.
      kdcHostname: '',
    });
  }
  if (file.providers.saml?.enabled) {
    const s = file.providers.saml;
    providers.push({
      type: 'saml',
      enabled: true,
      entryPoint: s.entryPoint,
      issuer: s.issuer,
      cert: s.cert,
      callbackUrl: s.callbackUrl,
      ...(s.attributeMapping ? { attributeMapping: s.attributeMapping } : {}),
      ...(s.wantAssertionsSigned !== undefined ? { wantAssertionsSigned: s.wantAssertionsSigned } : {}),
      ...(s.identifierFormat ? { identifierFormat: s.identifierFormat } : {}),
    });
  }
  if (file.providers.oidc?.enabled) {
    const o = file.providers.oidc;
    providers.push({
      type: 'oidc',
      enabled: true,
      issuer: o.issuer,
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      callbackUrl: o.redirectUri,
      scopes: o.scope.split(/\s+/).filter(Boolean),
    });
  }

  // Always include the local fallback. The provider's own
  // `allowedInProduction` flag + the AuthManager's NODE_ENV check
  // refuse the call at runtime when production policy says so.
  providers.push({
    type: 'local',
    enabled: true,
    warningBanner: true,
    allowedInProduction: false,
  });

  const roleMapping: RoleMapping[] = (file.roleMapping?.platformAdmin ?? []).map((g) => ({
    idpGroup: g,
    platformRole: 'platform-admin',
  }));

  return {
    providers,
    roleMapping,
    defaultRole: file.roleMapping?.defaultRole ?? 'user',
    sessionTtlMinutes: file.sessionTtlMinutes ?? 480,
  };
}
