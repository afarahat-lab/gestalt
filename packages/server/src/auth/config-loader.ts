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
import type { IdentityConfig } from './types';
import { createContextLogger } from '@gestalt/core';
import { loadAuthConfigFile, toIdentityConfig } from './auth-config';

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
  // ADR-040 — try auth.config.json first.
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
