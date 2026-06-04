/**
 * Shared project-id resolver for CLI commands that accept
 * `--project <name>`.
 *
 * Translates a human-friendly project name into the project's UUID
 * BEFORE any value is sent to the server. Every command that supplies
 * `--project` must run the value through this helper — passing the
 * raw name straight to the API can land a non-UUID string in
 * `intents.project_id` (a `text` column) and then trip
 * `22P02 invalid input syntax for type uuid` the next time the
 * orchestrator tries to load the project record. That failure mode is
 * the subject of `docs/claude/TEST_REPORT_001.md` (Fix A).
 *
 * Resolution order:
 *   1. If `projectName` looks like a UUID, return it verbatim — the
 *      caller can pass either form, identical to how
 *      `gestalt projects use` already accepts both.
 *   2. If `projectName` is a non-UUID string, list the operator's
 *      visible projects, match by name (case-insensitive), and return
 *      the UUID. No match → exit(1) with a hint to run
 *      `gestalt projects list`.
 *   3. If `projectName` is absent, fall back to `currentProjectId`
 *      (which `gestalt projects use` writes as a UUID; safe by
 *      construction).
 */

import { GestaltApiClient } from '../api/client';
import { c } from './prompts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

export async function resolveProjectId(
  client: GestaltApiClient,
  currentProjectId: string | null,
  projectName?: string,
): Promise<string | null> {
  if (projectName) {
    const trimmed = projectName.trim();
    if (UUID_RE.test(trimmed)) return trimmed;

    const { data: projects } = await client.listProjects();
    const match = projects.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!match) {
      console.log(
        c.error(`No project named '${trimmed}'. Run \`gestalt projects list\`.`),
      );
      process.exit(1);
    }
    return match.id;
  }
  return currentProjectId;
}
