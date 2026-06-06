/**
 * Universal evidence requirement for any agent that emits findings,
 * violations, or signals (TEST_REPORT_013).
 *
 * TR_010 / TR_011 / TR_012 proved that review-agent and constraint-agent
 * persistently hallucinate findings (e.g. "Direct DB access in service"
 * against code that correctly delegates to a repository). TR_012's
 * mandatory tool-first protocol was ignored by gpt-4o-mini in 0/64
 * executions.
 *
 * This module replaces the tool-call mandate with a structural
 * requirement: every finding MUST carry `quotedLine` — the exact line
 * from the artifact that constitutes the violation. The parser drops
 * any finding whose `quotedLine` is empty, so a finding the LLM cannot
 * ground in a specific line is discarded before reaching the gate.
 *
 * No hardcoded patterns. No language-specific logic. The LLM still
 * decides what is a violation; this module only requires that it
 * point at the exact line that proves it.
 */

import type { LogContext } from '../logger/index';

/**
 * Prompt section telling the LLM that every finding it emits must
 * include a verbatim quote of the violating line. Inject ABOVE the
 * task section of any agent that emits findings.
 *
 * Findings without `quotedLine` are dropped by `dropUnevidencedFindings`
 * before they reach the gate — see Part 1 of TR_013.
 */
export const EVIDENCE_REQUIREMENT_SECTION = `
## Evidence requirement — mandatory for every finding

Every finding you emit MUST include the exact line of code that
constitutes the violation, quoted verbatim from the artifact.

Rules:
- "quotedLine" is REQUIRED on every finding item
- The quoted line must appear verbatim in the artifact you are reviewing
- The quoted line must be the line that IS the violation — not a
  surrounding comment, import statement, or unrelated line
- If you cannot find a specific line that proves the violation,
  you MUST NOT emit the finding — omit it entirely
- An import statement alone is never sufficient evidence of a violation.
  Quote the line that misuses what was imported.

Valid examples of quoted evidence:
  "quotedLine": "const result = await pool.query('SELECT * FROM users')"
  "quotedLine": "res.status(500).json({ error: err.stack })"
  "quotedLine": "const input = JSON.parse(req.body.raw)"

Invalid evidence — do NOT emit a finding based on these alone:
  "quotedLine": "import { Pool } from 'pg'"
  "quotedLine": "import { ILeaveRepository } from './leave.repository'"
  "quotedLine": "constructor(private repo: ILeaveRepository)"
  "quotedLine": "implements ILeaveRepository"

If you have no quotable evidence: do not emit the finding.
`;

/**
 * The `quotedLine` field as it appears inside the JSON response
 * schema rendered to the LLM. Concatenate into the schema block of
 * any agent that emits findings so the field is part of the contract
 * the model sees.
 */
export const QUOTED_LINE_SCHEMA_FIELD =
  `"quotedLine": "the exact violating line copied verbatim from the artifact"`;

/**
 * Logger shape that {@link dropUnevidencedFindings} writes to. Subset
 * of the platform logger so callers can pass either a context-bound
 * `createContextLogger` instance or a minimal stub.
 */
export interface EvidenceLogger {
  info: (meta: LogContext | Record<string, unknown>, msg: string) => void;
}

/**
 * Drop findings whose `quotedLine` is missing or empty. Call this in
 * the LLM-response parser of any agent that emits findings — it is
 * the sole enforcement mechanism for the evidence requirement
 * (no hardcoded pattern matching, no language-specific filters).
 *
 * Each dropped finding is logged at `info` level with the offending
 * file + message prefix so operators can see how often the gate is
 * catching hallucinations.
 */
export function dropUnevidencedFindings<
  T extends { quotedLine?: string; message?: string; description?: string; explanation?: string; file?: string },
>(findings: T[], log: EvidenceLogger): T[] {
  return findings.filter((f) => {
    if (!f.quotedLine || f.quotedLine.trim() === '') {
      const text = f.message ?? f.description ?? f.explanation ?? '';
      log.info(
        { file: f.file, message: text.slice(0, 80) },
        'Finding dropped — no quoted evidence provided by LLM',
      );
      return false;
    }
    return true;
  });
}
