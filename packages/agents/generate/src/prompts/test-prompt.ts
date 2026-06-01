/**
 * LLM prompt builder for the test agent.
 *
 * The test-agent runs immediately after the code-agent and sees its
 * output via `priorArtifacts` (type === 'code'). Section order:
 *
 *   1. Success criteria   — from the intent spec; one test per
 *                           criterion at minimum
 *   2. Generated code     — truncated per-file so the LLM can write
 *                           targeted tests against real symbols
 *   3. Constraint rules   — tests must not introduce their own
 *                           violations (e.g. no-console in test files
 *                           still fires)
 *   4. Signal feedback    — retry cycles only
 *   5. Task instructions  — Vitest output format
 */

import type { ContextSnapshot, FeedbackSignal } from '../types';
import { applyAgentConfig } from './agent-config-helpers';
import { buildSignalFeedback } from './signal-formatter';

const PER_FILE_TRUNCATE_CHARS = 2000;
const MAX_CODE_SECTION_CHARS = 8000;

export function buildTestPrompt(
  ctx: ContextSnapshot,
  attempt: number,
  priorSignals: FeedbackSignal[] = ctx.priorSignals ?? [],
): string {
  const retry =
    attempt > 0
      ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only — no commentary, no markdown fences.`
      : '';

  // ── 1. Success criteria ────────────────────────────────────────────
  const criteriaSection =
    ctx.intentSpec.successCriteria.length > 0
      ? `## Success criteria — write tests that verify these\n\n` +
        ctx.intentSpec.successCriteria
          .map((c, i) => {
            const layer = (c as { layer?: string }).layer ?? 'unit';
            const description =
              (c as { description?: string }).description ?? String(c);
            return `SC-${i + 1} (${layer}): ${description}`;
          })
          .join('\n')
      : '';

  // ── 2. Generated code from prior artifacts ─────────────────────────
  const codeArtifacts = ctx.priorArtifacts.filter((a) => a.type === 'code');
  let codeSectionContent = '';
  if (codeArtifacts.length > 0) {
    const fileBlocks = codeArtifacts.map((a) => {
      const head =
        a.content.length > PER_FILE_TRUNCATE_CHARS
          ? a.content.slice(0, PER_FILE_TRUNCATE_CHARS) +
            `\n// [...truncated ${a.content.length - PER_FILE_TRUNCATE_CHARS} chars]`
          : a.content;
      return `### ${a.path}\n\`\`\`typescript\n${head}\n\`\`\``;
    });
    codeSectionContent = fileBlocks.join('\n\n');
    if (codeSectionContent.length > MAX_CODE_SECTION_CHARS) {
      codeSectionContent =
        codeSectionContent.slice(0, MAX_CODE_SECTION_CHARS) +
        `\n\n[...code section truncated for prompt budget]`;
    }
  }
  const codeSection = codeSectionContent
    ? `## Generated code to test\n\n${codeSectionContent}`
    : '';

  // ── 3. Constraint rules apply to tests too ─────────────────────────
  const constraintRules = ctx.harness?.constraints?.rules ?? [];
  const constraintsSection =
    constraintRules.length > 0
      ? `## Constraint rules apply to test files too\n\n` +
        constraintRules.map((r) => `- **${r.id}**: ${r.description}`).join('\n')
      : '';

  // ── 4. Signal feedback (retry cycles) ──────────────────────────────
  const signalsSection = buildSignalFeedback(priorSignals);

  // ── 5. Task instructions ───────────────────────────────────────────
  const taskSection =
    `## Your task\n\n` +
    `Generate a Vitest test file for each success criterion layer.${retry}\n\n` +
    `Return a JSON object:\n\n` +
    '```json\n' +
    `{\n  "files": [\n    { "path": "src/modules/<module>/__tests__/<name>.test.ts", "content": "..." }\n  ]\n}\n` +
    '```\n\n' +
    `Test rules:\n` +
    `- Use Vitest (\`import { describe, it, expect, vi } from 'vitest'\`)\n` +
    `- Unit tests: test functions in isolation with \`vi.mock()\` for dependencies\n` +
    `- Integration tests: test full request/response with supertest\n` +
    `- One describe block per success criterion\n` +
    `- Test both the happy path AND error cases\n` +
    `- Assertions must be specific — no \`toBeTruthy()\` without good reason\n` +
    `- Mock external dependencies (DB, LLM) — never real calls in tests`;

  const body = [
    criteriaSection,
    codeSection,
    constraintsSection,
    signalsSection,
    taskSection,
  ]
    .filter(Boolean)
    .join('\n\n');

  return applyAgentConfig(body, ctx.agentConfig);
}
