/**
 * Resolve a user-supplied intent identifier (full UUID, 8-char
 * correlationId prefix, full correlationId, or 8-char intent-id
 * prefix) to the intent's internal UUID — the form `/intents/:id`
 * expects.
 *
 * Used by every command that takes `<intentId>` as input: `gestalt
 * intent show`, `gestalt gate show`, `gestalt deploy show`, `gestalt
 * status --id`. Keeps the resolution logic in one place so an 8-char
 * prefix means the same thing everywhere.
 *
 * Resolution order (Fix E — `docs/claude/TEST_REPORT_001.md`):
 *   1. If the input is a full UUID, return it verbatim — the server
 *      404s cleanly if it's an unknown id, and we save a list call
 *      for the common copy-paste flow.
 *   2. List the current project's recent intents and `startsWith`
 *      match the input against both `correlationId` AND `id`. The
 *      prior implementation matched only `correlationId`, so an
 *      operator copy-pasting `intent.id` from the DB never matched.
 *   3. If nothing matched and a project filter is in scope, broaden
 *      the search to every project the operator can see. Catches the
 *      case where the failing intent's `project_id` doesn't match
 *      the operator's current project (e.g. older rows from a
 *      different `gestalt projects use` selection).
 *   4. Ambiguous prefixes error with the match count; missing
 *      intents error with a hint to run `gestalt intent list`.
 */

import { GestaltApiClient } from '../api/client';
import { c } from './prompts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_LIMIT = 100;

export async function resolveIntentId(
  client: GestaltApiClient,
  idOrPrefix: string,
  currentProjectId: string | null,
): Promise<string> {
  const trimmed = idOrPrefix.trim().toLowerCase();
  if (trimmed.length === 0) {
    console.log(c.error('Intent id required.'));
    process.exit(1);
  }

  // Full UUID — server handles existence. `/intents/:id` keys on the
  // INTERNAL intent UUID, not the correlationId, but operators who
  // paste a full correlationId end up routed through the lookup loop
  // below where we match against both columns. So the only thing the
  // happy path here gains is "skip the list call for unambiguous
  // full-UUID inputs."
  if (UUID_RE.test(trimmed)) {
    // Still try a correlationId hit — when the user pasted a full
    // correlationId we need to translate it to the intent UUID.
    const fromCorrelation = await tryResolveByPrefix(client, trimmed, currentProjectId);
    if (fromCorrelation) return fromCorrelation;
    return trimmed;
  }

  // 8-char (or longer) prefix — match against either correlationId
  // OR intent.id within the current project; broaden server-wide on
  // miss.
  const resolved = await tryResolveByPrefix(client, trimmed, currentProjectId);
  if (resolved) return resolved;

  console.log(c.error(`No intent matches '${trimmed}'.`));
  console.log(c.dim('  Try: gestalt intent list'));
  process.exit(1);
}

async function tryResolveByPrefix(
  client: GestaltApiClient,
  prefix: string,
  currentProjectId: string | null,
): Promise<string | null> {
  // Scope 1 — current project (when set).
  if (currentProjectId) {
    const local = await listAndMatch(client, prefix, currentProjectId);
    if (local) return local;
  }

  // Scope 2 — server-wide (the user's accessible projects on the
  // server side; platform-admin gets full visibility). Use the empty
  // projectId override per the server contract at
  // `packages/server/src/routes/intents.ts:144-180`.
  return await listAndMatch(client, prefix, '');
}

async function listAndMatch(
  client: GestaltApiClient,
  prefix: string,
  projectId: string,
): Promise<string | null> {
  const res = await client.listIntents({ projectId, limit: LOOKUP_LIMIT });
  const matches = res.data.filter(
    (i) =>
      i.correlationId.toLowerCase().startsWith(prefix)
      || i.id.toLowerCase().startsWith(prefix),
  );
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    console.log(c.error(`Ambiguous prefix '${prefix}' — ${matches.length} matches.`));
    process.exit(1);
  }
  return null;
}
