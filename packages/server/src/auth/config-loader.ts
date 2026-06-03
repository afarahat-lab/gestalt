/**
 * Loads identity configuration.
 *
 * Resolution order (ADR-040 introduced auth.config.json as the new
 * primary source; HARNESS.json identity remains for back-compat):
 *   1. `auth.config.json` in cwd or `/etc/gestalt/`
 *   2. `HARNESS.json` `identity` block in cwd
 *   3. Local-only default (ADR-025)
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { IdentityConfig, AuthProviderConfig, RoleMapping } from './types';
import { createContextLogger, getRepositories, decryptSecret, type IdentityConfigRecord } from '@gestalt/core';
import { loadAuthConfigFile, toIdentityConfig } from './auth-config';
import { getMasterKey } from '../secrets/index';

const log = createContextLogger({ module: 'auth:config-loader' });

const DEFAULT_IDENTITY_CONFIG: IdentityConfig = {
  providers: [
    {
      type: 'local',
      enabled: true,
      warningBanner: true,
      allowedInProduction: false,
    },
  ],
  roleMapping: [],
  defaultRole: 'user',
  sessionTtlMinutes: 480,
};

export async function loadIdentityConfig(): Promise<IdentityConfig> {
  // Session 3 — migration 017. DB-backed config takes precedence
  // over `auth.config.json`. Operators manage providers via the
  // dashboard's Identity tab; sensitive fields are vault-referenced
  // and decrypted here at load time.
  try {
    const dbConfig = await loadFromDatabase();
    if (dbConfig) {
      log.info(
        { providers: dbConfig.providers.filter((p) => p.enabled).map((p) => p.type) },
        'Identity config loaded from database',
      );
      return resolveEnvRefs(dbConfig);
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to load identity config from database — falling back to file',
    );
  }

  // ADR-040 — try auth.config.json next (backward compat).
  const authFile = await loadAuthConfigFile();
  if (authFile) {
    const config = toIdentityConfig(authFile);
    log.info(
      { providers: config.providers.filter((p) => p.enabled).map((p) => p.type) },
      'Identity config loaded from auth.config.json',
    );
    return resolveEnvRefs(config);
  }

  // Legacy HARNESS.json identity block.
  const harnessPath = join(process.cwd(), 'HARNESS.json');
  try {
    const raw = await readFile(harnessPath, 'utf8');
    const harness = JSON.parse(raw) as { identity?: IdentityConfig };

    if (!harness.identity) {
      log.info('No identity config in HARNESS.json — using local auth fallback');
      return DEFAULT_IDENTITY_CONFIG;
    }

    const resolved = resolveEnvRefs(harness.identity);
    log.info(
      { providers: resolved.providers.filter((p) => p.enabled).map((p) => p.type) },
      'Identity config loaded from HARNESS.json',
    );
    return resolved;
  } catch {
    log.info('No auth.config.json or HARNESS.json identity — using local auth fallback');
    return DEFAULT_IDENTITY_CONFIG;
  }
}

/**
 * Loads identity configuration from `platform_identity_config` (DB)
 * and `platform_role_mappings`. Returns null when the table is
 * empty so callers fall through to the file-based loader.
 *
 * Sensitive fields (`cert`, `clientSecret`, `keytabContent`) are
 * stored as `*SecretId` references inside the `config` JSONB; this
 * function resolves them via the vault before returning the
 * IdentityConfig shape AuthManager consumes. Secret values are
 * NEVER returned by the read route — only consumed here for the
 * in-process provider instantiation.
 */
async function loadFromDatabase(): Promise<IdentityConfig | null> {
  const { identityConfig, roleMappings } = getRepositories();
  const rows = await identityConfig.list();
  if (rows.length === 0) return null;

  const providers: AuthProviderConfig[] = [];
  for (const row of rows) {
    if (!row.enabled) continue;
    const resolved = await hydrateProviderConfig(row);
    if (resolved) providers.push(resolved);
  }
  // Always include the local fallback (mirrors the file loader).
  providers.push({
    type: 'local',
    enabled: true,
    warningBanner: true,
    allowedInProduction: false,
  });

  const mappings = await roleMappings.list();
  const roleMapping: RoleMapping[] = mappings.map((m) => ({
    idpGroup: m.groupName,
    platformRole: m.platformRole,
  }));

  return {
    providers,
    roleMapping,
    defaultRole: 'user',
    sessionTtlMinutes: 480,
  };
}

async function hydrateProviderConfig(
  row: IdentityConfigRecord,
): Promise<AuthProviderConfig | null> {
  const cfg = { ...row.config };

  // Vault-resolve every `*SecretId` reference into its plaintext
  // sibling field. We mutate a copy of the config — the persisted
  // row keeps the secret id pointer.
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && k.endsWith('SecretId')) {
      try {
        const secret = await getRepositories().platformSecrets.findById(v);
        if (secret) {
          const plain = decryptSecret(
            { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
            getMasterKey(),
          );
          const baseField = k.slice(0, -'SecretId'.length);
          (cfg as Record<string, unknown>)[baseField] = plain;
        }
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), provider: row.provider, field: k },
          'Vault decrypt failed for identity config secret reference',
        );
      }
      delete (cfg as Record<string, unknown>)[k];
    }
  }

  switch (row.provider) {
    case 'kerberos':
      return {
        type: 'windows-kerberos',
        enabled: true,
        spn: (cfg.serviceAccount as string) ?? '',
        realm: (cfg.realm as string) ?? '',
        kdcHostname: (cfg.kdcHostname as string) ?? '',
      };
    case 'saml': {
      const out: AuthProviderConfig = {
        type: 'saml',
        enabled: true,
        entryPoint: (cfg.entryPoint as string) ?? '',
        issuer: (cfg.issuer as string) ?? '',
        cert: (cfg.cert as string) ?? '',
        callbackUrl: (cfg.callbackUrl as string) ?? '',
      };
      const samlExtra: Record<string, unknown> = {};
      if (cfg.attributeMapping) samlExtra.attributeMapping = cfg.attributeMapping;
      if (cfg.wantAssertionsSigned !== undefined) samlExtra.wantAssertionsSigned = cfg.wantAssertionsSigned;
      if (cfg.identifierFormat) samlExtra.identifierFormat = cfg.identifierFormat;
      return { ...out, ...samlExtra } as AuthProviderConfig;
    }
    case 'oidc': {
      const scope = (cfg.scope as string) ?? 'openid profile email';
      return {
        type: 'oidc',
        enabled: true,
        issuer: (cfg.issuer as string) ?? '',
        clientId: (cfg.clientId as string) ?? '',
        clientSecret: (cfg.clientSecret as string) ?? '',
        callbackUrl: (cfg.redirectUri as string) ?? (cfg.callbackUrl as string) ?? '',
        scopes: scope.split(/\s+/).filter(Boolean),
      };
    }
    default:
      return null;
  }
}

/**
 * Resolves ${ENV_VAR} references in config string values.
 */
function resolveEnvRefs<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      return process.env[key] ?? '';
    }) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvRefs) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveEnvRefs(v)]),
    ) as T;
  }
  return obj;
}
