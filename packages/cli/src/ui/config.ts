/**
 * CLI configuration — persists server URL and auth token
 * in ~/.gestalt/config.json between sessions.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { CliConfig } from '../types';
import { DEFAULT_CLI_CONFIG } from '../types';

const CONFIG_DIR = join(homedir(), '.gestalt');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export async function loadCliConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return { ...DEFAULT_CLI_CONFIG, ...JSON.parse(raw) } as CliConfig;
  } catch {
    return { ...DEFAULT_CLI_CONFIG };
  }
}

export async function saveCliConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export async function updateCliConfig(patch: Partial<CliConfig>): Promise<CliConfig> {
  const current = await loadCliConfig();
  const updated = { ...current, ...patch };
  await saveCliConfig(updated);
  return updated;
}

// ─── Server URL helpers ───────────────────────────────────────────────────────

/**
 * Pick the server URL for this invocation:
 *   --server <url> on the command line wins (one-shot override; not persisted
 *   unless the caller chooses to). Otherwise fall back to the persisted
 *   `serverUrl` in ~/.gestalt/config.json (which itself defaults to
 *   `http://localhost:3000` from `DEFAULT_CLI_CONFIG`).
 *
 * Centralised so every command sources the URL through one helper instead of
 * reading `config.serverUrl` directly.
 */
export function resolveServerUrl(
  options: { server?: string },
  config: CliConfig,
): string {
  return options.server ?? config.serverUrl;
}

/**
 * Strip a trailing slash and validate the URL is HTTP(S). Used by
 * `gestalt config set-server` and any other code path that accepts a URL
 * from the user. Throws on invalid input — callers should catch and present
 * a friendly message.
 */
export function normaliseServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Server URL is required.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  return trimmed;
}

export function isDefaultServerUrl(url: string): boolean {
  return url === DEFAULT_CLI_CONFIG.serverUrl;
}
