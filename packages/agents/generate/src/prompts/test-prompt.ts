/**
 * LLM prompt builder for the test agent.
 *
 * The test-agent runs immediately after the code-agent and sees its
 * output via `priorArtifacts` (type === 'code'). Section order:
 *
 *   1. Framework mandate  — TEST_REPORT_002 Fix 3a + Fix 6. Pinned
 *                           to the project's declared testFramework
 *                           (HARNESS.json stack.testFramework) BEFORE
 *                           any other section so the LLM cannot drift
 *                           to a different framework. Also pins the
 *                           output path layout (tests/unit/*).
 *   2. Success criteria   — from the intent spec; one test per
 *                           criterion at minimum
 *   3. Generated code     — truncated per-file so the LLM can write
 *                           targeted tests against real symbols
 *   4. Constraint rules   — tests must not introduce their own
 *                           violations (e.g. no-console in test files
 *                           still fires)
 *   5. Signal feedback    — retry cycles only
 *   6. Task instructions  — output JSON shape; framework rules
 *                           re-asserted as a closing rule list
 */

import type { ContextSnapshot, FeedbackSignal } from '../types';
import { applyAgentConfig } from './agent-config-helpers';
import { buildSignalFeedback } from './signal-formatter';

const PER_FILE_TRUNCATE_CHARS = 2000;
const MAX_CODE_SECTION_CHARS = 8000;

/**
 * Per-framework import + globals guidance. Keep keys lowercased for
 * lookup; resolve the framework name case-insensitively below.
 */
const FRAMEWORK_GUIDE: Record<string, { importLine: string; mockLine: string; describe: string }> = {
  jest: {
    importLine: `import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';`,
    mockLine: `jest.mock('<dep>', () => ({ /* manual mock */ }));`,
    describe: "Jest 29+ — the @jest/globals import is mandatory under TypeScript strict mode so the helpers are typed.",
  },
  vitest: {
    importLine: `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';`,
    mockLine: `vi.mock('<dep>', () => ({ /* manual mock */ }));`,
    describe: "Vitest — vi.* helpers, top-level imports from 'vitest'.",
  },
  mocha: {
    importLine: `import { describe, it, before, after, beforeEach, afterEach } from 'mocha';\nimport { expect } from 'chai';`,
    mockLine: `// Mocha leaves mocking to sinon — `,
    describe: 'Mocha + Chai — sinon for mocking.',
  },
};

function resolveFrameworkGuide(framework: string): { name: string; importLine: string; mockLine: string; describe: string } | null {
  const key = framework.trim().toLowerCase();
  const guide = FRAMEWORK_GUIDE[key];
  if (!guide) return null;
  return { name: framework.trim(), ...guide };
}

export function buildTestPrompt(
  ctx: ContextSnapshot,
  attempt: number,
  priorSignals: FeedbackSignal[] = ctx.priorSignals ?? [],
): string {
  const retry =
    attempt > 0
      ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only — no commentary, no markdown fences.`
      : '';

  // ── 1. Framework mandate ───────────────────────────────────────────
  //
  // TEST_REPORT_002 Fix 3a — read the test framework from the
  // project's HARNESS.json `stack.testFramework`. Default to Jest
  // when unset (matches the corporate-ops-web-mobile template and
  // the historical baseline). The mandate goes FIRST so the LLM
  // never drifts to a different framework based on what it sees
  // in the generated code or the task example.
  const declaredFramework = (
    ctx.harness?.stack?.['testFramework'] ?? 'Jest'
  ).trim();
  const guide = resolveFrameworkGuide(declaredFramework);
  const frameworkSection = guide
    ? `## Test framework — MANDATORY\n\n` +
      `This project declares **${guide.name}** as its test framework (HARNESS.json stack.testFramework).\n` +
      `You MUST use ${guide.name}. Do NOT use any other framework.\n\n` +
      `Required import line for every test file:\n\n` +
      '```ts\n' +
      `${guide.importLine}\n` +
      '```\n\n' +
      `Mocking pattern:\n\n` +
      '```ts\n' +
      `${guide.mockLine}\n` +
      '```\n\n' +
      `${guide.describe}\n\n` +
      `**Forbidden imports** (a test file importing any of these will fail the quality gate):\n` +
      Object.entries(FRAMEWORK_GUIDE)
        .filter(([k]) => k !== guide.name.toLowerCase())
        .map(([k]) => `- \`from '${k}'\``)
        .join('\n')
    : `## Test framework — MANDATORY\n\n` +
      `This project declares **${declaredFramework}** as its test framework.\n` +
      `Use ${declaredFramework} idioms throughout — do NOT use any other framework.`;

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
  //
  // TEST_REPORT_002 Fix 6 — test placement rule lives in the task
  // section so it is the LAST thing the LLM reads before responding.
  // tests/unit/ mirroring src/, NOT src/modules/<config-name>/, NOT
  // co-located inside `src/`. Config-file tests (package.json,
  // tsconfig.json, jest.config.js) live under tests/unit/config/.
  const frameworkName = guide?.name ?? declaredFramework;
  const importExample = guide?.importLine ?? '';
  const mockHelper = guide?.name.toLowerCase() === 'jest' ? 'jest.mock' : guide?.name.toLowerCase() === 'vitest' ? 'vi.mock' : 'your-framework.mock';

  const taskSection =
    `## Your task\n\n` +
    `Generate a ${frameworkName} test file for each success criterion.${retry}\n\n` +
    `Return a JSON object:\n\n` +
    '```json\n' +
    `{\n  "files": [\n    { "path": "tests/unit/<mirror of src path>.test.ts", "content": "..." }\n  ]\n}\n` +
    '```\n\n' +
    `## Test file placement (TEST_REPORT_002 Fix 6)\n` +
    `- Unit tests for source files in \`src/\` go in \`tests/unit/\` mirroring the source structure.\n` +
    `  Example: \`src/shared/types/index.ts\` → \`tests/unit/shared/types/index.test.ts\`.\n` +
    `- Integration tests go in \`tests/integration/\`.\n` +
    `- Tests for repo-root config files (package.json, tsconfig.json, jest.config.js) go in \`tests/unit/config/\`.\n` +
    `- Do **NOT** create test files inside \`src/\`.\n` +
    `- Do **NOT** invent module directories under \`src/modules/\` just to host config tests.\n\n` +
    `## Test rules\n` +
    `- Use **${frameworkName}** — no other framework. The mandate at the top of this prompt is binding.\n` +
    (importExample ? `- First import line MUST be: \`${importExample}\`\n` : '') +
    `- Unit tests: test functions in isolation with \`${mockHelper}()\` for dependencies\n` +
    `- Integration tests: test full request/response with supertest\n` +
    `- One describe block per success criterion\n` +
    `- Test both the happy path AND error cases\n` +
    `- Assertions must be specific — no \`toBeTruthy()\` without good reason\n` +
    `- Mock external dependencies (DB, LLM) — never real calls in tests`;

  const body = [
    frameworkSection,
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
