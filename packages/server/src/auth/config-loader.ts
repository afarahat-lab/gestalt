/**
 * Loads identity configuration from HARNESS.json in the current working directory.
 * Falls back to local-only auth if no identity config is present.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { IdentityConfig } from './types';
import { createContextLogger } from '@gestalt/core';

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
  const harnessPath = join(process.cwd(), 'HARNESS.json');

  try {
    const raw = await readFile(harnessPath, 'utf8');
    const harness = JSON.parse(raw) as { identity?: IdentityConfig };

    if (!harness.identity) {
      log.warn('No identity config in HARNESS.json — using local auth fallback');
      return DEFAULT_IDENTITY_CONFIG;
    }

    // Resolve environment variable references in provider configs
    const resolved = resolveEnvRefs(harness.identity);
    log.info(
      { providers: resolved.providers.filter((p) => p.enabled).map((p) => p.type) },
      'Identity config loaded',
    );
    return resolved;
  } catch {
    log.warn('HARNESS.json not found or unreadable — using local auth fallback');
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
