/**
 * Resolve a user-supplied intent identifier (full UUID, 8-char
 * correlationId prefix, or full correlationId) to the intent's
 * internal UUID — the form `/intents/:id` expects.
 *
 * Used by every command that takes `<intentId>` as input: `gestalt
 * intent show`, `gestalt gate show`, `gestalt deploy show`, `gestalt
 * status --id`. Keeps the resolution logic in one place so an 8-char
 * prefix means the same thing everywhere.
 *
 * Ambiguous prefixes error with the match count; missing intents
 * error with a hint to run `gestalt intent list`.
 */

import { GestaltApiClient } from '../api/client';
import { c } from './prompts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the intent's INTERNAL UUID (`intents.id`). The server's
 * `/intents/:id` route keys on this, NOT on the correlationId — so
 * even a full correlationId UUID needs to be translated first.
 *
 * Resolution order:
 *   1. Look up against the current project's intents (or the
 *      server-wide list for platform-admins) and match against
 *      `correlationId` either by full equality or `startsWith`
 *      for prefixes
 *   2. If nothing matches but the input is itself a full UUID, fall
 *      back to treating it as the intent UUID — the server will 404
 *      cleanly if it's wrong
 */
export async function resolveIntentId(
  client: GestaltApiClient,
  idOrPrefix: string,
  currentProjectId: string | null,
): Promise<string> {
  const trimmed = idOrPrefix.trim();
  if (trimmed.length === 0) {
    console.log(c.error('Intent id required.'));
    process.exit(1);
  }

  // Always try the correlationId lookup first — the user almost
  // always pastes the `correlationId` (which is what `gestalt run`
  // surfaces) and intent UUIDs are rarely seen.
  const candidates = currentProjectId
    ? (await client.listIntents({ projectId: currentProjectId, limit: 100 })).data
    : (await client.listIntents({ projectId: '', limit: 100 })).data;

  const matches = candidates.filter((i) => i.correlationId.startsWith(trimmed));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    console.log(c.error(`Ambiguous prefix '${trimmed}' — ${matches.length} matches.`));
    process.exit(1);
  }

  // Nothing matched as a correlationId. If the input itself is a
  // full UUID, treat it as the intent UUID and let the server tell
  // us if it's wrong.
  if (UUID_RE.test(trimmed)) return trimmed;

  console.log(c.error(`No intent matches '${trimmed}'.`));
  console.log(c.dim('  Try: gestalt intent list'));
  process.exit(1);
}
