/**
 * Project Git PAT resolver — shared helper for every orchestrator,
 * agent, and route that needs to clone a project repository.
 *
 * Migration 022 introduced `projects.git_secret_id` — when set, the
 * project's Git PAT is stored encrypted at rest in
 * `platform_secrets` instead of plain in `project_git_credentials`.
 * This helper enforces the precedence:
 *
 *   1. `project.gitSecretId` is set → vault-decrypted secret value
 *      (via the injected `ProjectSecretResolver` — defined server-
 *      side because the master key never reaches `@gestalt/core`).
 *   2. `project.gitSecretId` is null → fall back to the legacy
 *      plain-token path in `project_git_credentials`.
 *   3. Neither present → `null` (callers surface a clean
 *      "no credential" error).
 *
 * The resolver injection mirrors the `setLLMRegistryResolver` +
 * `setPlatformMcpResolver` pattern from migrations 014 and 017 —
 * server-side wiring keeps vault decryption out of core while every
 * call site reads a single sync-shaped API.
 */

import { getRepositories } from '../repository/index';
import type { ProjectRecord } from '../repository/index';

/**
 * Decrypt-then-return the plaintext PAT for a given vault secret id.
 * Returns `null` when the secret can't be resolved (deleted, decrypt
 * failure, master key not loaded) so callers can fall back to the
 * plain-token path. The server's resolver logs the failure with the
 * secret id but NEVER the key material.
 */
export type ProjectSecretResolver = (
  secretId: string,
) => Promise<string | null>;

let _projectSecretResolver: ProjectSecretResolver | null = null;

/**
 * Wires the vault-decrypt function. Called once at server boot
 * after the master key is loaded and the database adapter is
 * ready. Passing `null` disables the vault path (the helper falls
 * back to `projects.getCredential` for every project).
 */
export function setProjectSecretResolver(
  resolver: ProjectSecretResolver | null,
): void {
  _projectSecretResolver = resolver;
}

/**
 * Resolve a project's Git PAT — vault first, plain token fallback.
 *
 * Call sites use this in place of `projects.getCredential(id)`. The
 * returned token is decrypted in-memory and must NEVER be persisted
 * or logged.
 */
export async function resolveProjectCredential(
  project: ProjectRecord,
): Promise<string | null> {
  if (project.gitSecretId && _projectSecretResolver) {
    const token = await _projectSecretResolver(project.gitSecretId);
    if (token) return token;
    // Vault lookup failed (deleted / decrypt error). Fall through to
    // the plain-token path — operator may have a backup credential.
  }
  return getRepositories().projects.getCredential(project.id);
}
