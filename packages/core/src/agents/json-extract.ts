/**
 * LLM JSON-output extractor.
 *
 * The LLM-using agents in every layer (generate / gate / maintenance)
 * prompt for JSON-only output, but models with tool-use enabled tend
 * to prepend a prose summary of what they just observed before
 * emitting the JSON. Strictly-prompted retries help but don't
 * eliminate it; the model may also wrap the JSON in ```json fences.
 *
 * This helper handles three observed shapes:
 *   1. Bare JSON                  → returned unchanged
 *   2. JSON wrapped in ``` fences → fences stripped
 *   3. JSON preceded / followed by prose narration → first balanced
 *      top-level `{...}` block extracted
 *
 * If the input doesn't contain a `{`, returns it unchanged so the
 * caller's `JSON.parse` failure surfaces the original bad output
 * rather than a misleading "extracted nothing" error.
 *
 * Brace counting is intentional rather than greedy first-`{` /
 * last-`}` slicing — when prose narration itself contains `{` or `}`
 * (common in code-walkthrough narration), the greedy approach
 * captures non-JSON characters and the parser fails on a structurally
 * valid but contextually wrong span. The counter tracks string
 * literals + escapes so braces inside JSON string values don't
 * misalign the count.
 */

export function extractJsonObject(raw: string): string {
  const stripped = raw.replace(/```json|```/g, '').trim();
  if (!stripped.includes('{')) return stripped;

  // Fast path — the response IS a JSON object.
  if (stripped.startsWith('{') && stripped.endsWith('}')) {
    return stripped;
  }

  // Walk every balanced top-level `{...}` block and return the first
  // one that `JSON.parse` accepts. This avoids false positives when
  // the model's prose narration itself contains brace-shaped tokens
  // (markdown-formatted `{key}`, template-string examples, etc.) —
  // the first balanced block is matched but doesn't parse; the
  // extractor continues to the next.
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(stripped.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  // No candidate parsed cleanly — return the first one so the
  // caller's parse failure surfaces the most-likely-JSON span
  // (rather than the original unbounded prose).
  if (candidates.length > 0) return candidates[0]!;
  // Unbalanced — return everything from the first `{` to end so the
  // caller's parse error carries the maximum possible context.
  const firstBrace = stripped.indexOf('{');
  return firstBrace >= 0 ? stripped.slice(firstBrace) : stripped;
}

/**
 * `extractJsonObject` + `JSON.parse` in one call. Throws the underlying
 * parse error on failure — callers' existing try/catch / retry logic
 * still works.
 */
export function parseLlmJson<T = unknown>(raw: string): T {
  return JSON.parse(extractJsonObject(raw)) as T;
}
