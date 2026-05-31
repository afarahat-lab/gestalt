/**
 * Cross-repository utilities for the postgres adapter.
 */

/**
 * Defensive JSONB-column reader.
 *
 * postgres.js can return a JSONB column as either:
 *   - the parsed JS value (object or array), when a parser is
 *     registered or the column was written via `JSON_BUILD_*` /
 *     parameter binding that the driver introspected
 *   - the raw JSON-encoded string, when the value was bound via an
 *     explicit `::jsonb` cast on a TEXT payload, or when type
 *     adapters weren't registered for the column
 *
 * The three JSONB read paths in the repo (alerts.context,
 * maintenance_runs.findings, deployment_events.metadata) all hit this
 * inconsistency. This helper consolidates the defensive parse so the
 * next JSONB column doesn't need a copy-paste fix.
 *
 * Returns `fallback` on:
 *   - null / undefined input
 *   - non-string, non-object input
 *   - a `JSON.parse` failure
 *   - a parsed value whose shape doesn't match the fallback's
 *     (preserves the prior per-repo behaviour — `parseFindings`
 *     rejected non-array parsed values, `parseContext` /
 *     `parseMetadata` rejected non-object parsed values)
 *
 * Signature note: the brief sketched `parseJsonb<T>(value): T`. A
 * single-arg version can't carry shape information to runtime, so a
 * `fallback: T` parameter is added — the caller's expected shape is
 * inferred from it (array fallback → only accept arrays; object
 * fallback → accept any non-null object including arrays). Same
 * three-line call sites, no behaviour change.
 */
export function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;

  if (typeof value === 'object') {
    return matchesShape(value, fallback) ? (value as T) : fallback;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return matchesShape(parsed, fallback) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

/**
 * Shape gate: does `value` look like something the caller would accept,
 * given their `fallback`?
 *
 *  - fallback is an array → require an array (preserves the
 *    `parseFindings` "non-array → []" rule)
 *  - fallback is any other object → accept any non-null object,
 *    including arrays (preserves the `parseContext` / `parseMetadata`
 *    "non-null object" rule)
 *  - anything else → reject (the three current callers always pass an
 *    object/array fallback)
 */
function matchesShape(value: unknown, fallback: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(fallback)) return Array.isArray(value);
  return true;
}
