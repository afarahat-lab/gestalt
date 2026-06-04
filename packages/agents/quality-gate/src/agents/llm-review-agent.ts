/**
 * LLM review agent — qualitative code review.
 *
 * Sends the artifact set to the platform LLM with a structured-output
 * prompt asking for concerns about:
 *   - security (input validation, injection, auth)
 *   - architecture (module boundaries, separation of concerns)
 *   - golden-principle adherence (audit on mutation, RBAC, etc.)
 *   - clear bugs (missing error handling, dangling references)
 *
 * The full prose review is persisted as an artifact (`.gestalt/llm-review-
 * <correlationId>.md`) so the operator can read the qualitative feedback
 * even when the verdict is `pass`. Concrete blocking concerns are also
 * emitted as `CONSTRAINT_VIOLATION` / `GOLDEN_PRINCIPLE_BREACH` signals;
 * low/info-severity comments stay in the artifact only and do not fail
 * the gate.
 *
 * Inherits from `BaseLLMAgent` in `@gestalt/agents-generate` for the
 * shared `callLLM` helper (per-agent model routing via Step 1's
 * multi-client registry, instance-captured `lastPrompt` /
 * `lastLlmResponse` / `lastModelUsed`). The agent has its own entry
 * point `review(task)` because the gate operates on `GateTask`, not
 * the generate-layer `AgentTask` shape — so `buildPrompt` /
 * `parseResponse` from the base template are stubbed.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ArtifactRef, GateAgentResult, GateSignal, GateTask } from '../types';
import type { Artifact, ConstraintRule, SignalSeverity } from '@gestalt/core';
import { loadAgentConfig, BaseLLMAgent, extractJsonObject } from '@gestalt/core';
import type { AgentConfig } from '@gestalt/core';
import type { AgentResult } from '@gestalt/agents-generate';

interface LLMReviewItem {
  file?: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'architecture' | 'golden-principle' | 'bug' | 'style';
  message: string;
  fixHint?: string;
}

interface LLMReview {
  summary: string;
  overallVerdict: 'pass' | 'concerns' | 'block';
  items: LLMReviewItem[];
}

export interface LLMReviewArtifact extends Artifact {
  type: 'design';
}

export interface LLMReviewAgentResult extends GateAgentResult {
  reviewArtifact: LLMReviewArtifact | null;
}

const MAX_ARTIFACT_BYTES = 8000;   // per file, when bundling into the prompt
const MAX_TOTAL_BYTES = 60_000;    // prompt budget guard

export class ReviewAgent extends BaseLLMAgent {
  constructor() { super('review-agent'); }

  /**
   * Runs the LLM review against the gate task's artifact set. The
   * orchestrator reads `lastPrompt` / `lastLlmResponse` /
   * `lastModelUsed` from this instance after the call returns to
   * persist into `agent_execution_logs`.
   */
  async review(task: GateTask): Promise<LLMReviewAgentResult> {
    const startedAt = Date.now();

    const codeArtifacts = task.artifacts.filter(
      (a) => a.type === 'code' || a.type === 'test' || a.type === 'context-file',
    );

    if (codeArtifacts.length === 0) {
      return {
        agentRole: 'review-agent',
        status: 'passed',
        signals: [],
        durationMs: Date.now() - startedAt,
        reviewArtifact: null,
      };
    }

    // Step 1 agent externalisation — role / goal / extensions /
    // model from agents.yaml. Loader never throws.
    const agentConfig = await loadAgentConfig(task.harnessConfig.projectRoot, 'review-agent');

    // Read project-defined constraint rules from HARNESS.json in the
    // cloned tree so the review-agent can flag violations the same way
    // the code-agent's prompt did. Absent / malformed file falls
    // through to empty rules.
    const projectRules = await loadConstraintRules(task.harnessConfig.projectRoot);

    // Scaffolding detection — when the intent says "scaffold", "set
    // up", "create", or "initialise" the model should NOT flag
    // missing implementations or absent RBAC/audit as violations.
    // Stubs are intentional in setup intents; flagging them produces
    // noise that drives retry cycles to no useful end.
    const isScaffolding = detectScaffolding(task.intentText);

    // TEST_REPORT_004 Fix 2 — extract `outOfScope` from the
    // intent-spec artifact. The intent-agent's artifact lives at
    // `.gestalt/<correlation-id>/intent-spec.json` and is on
    // `task.artifacts` even though it's filtered out of
    // `codeArtifacts` above (different `type`). When the operator
    // says "create the repository foundation, no API endpoints",
    // the resulting IntentSpec carries `outOfScope: ["UI layer",
    // "Any modules outside the Leave module", …]`. Without this
    // signal the review-agent extrapolates to layers the intent
    // explicitly excludes (GP-001 audit / GP-003 input validation /
    // missing @types/pg false-fires from TEST_REPORT_004).
    const intentSpecOutOfScope = extractIntentSpecOutOfScope(task.artifacts);

    // TEST_REPORT_004 Fix 3 — read project state files (package.json,
    // tsconfig.json, AGENTS.md) from the cloned project root so the
    // review-agent knows what's ALREADY on main. The
    // gate-orchestrator clones the project to `harnessConfig.projectRoot`
    // before dispatching this agent; reading from there is cheap.
    // The review-agent had been flagging "missing @types/pg in
    // devDependencies" even when the project's package.json on main
    // already shipped it — because the code-agent (correctly) doesn't
    // regenerate package.json on incremental intents, and the
    // review-agent only saw the artifact set.
    const projectStateFiles = await loadProjectStateFiles(task.harnessConfig.projectRoot);

    const prompt = buildReviewPrompt(
      codeArtifacts,
      task.harnessConfig.goldenPrinciples,
      projectRules,
      agentConfig,
      isScaffolding,
      task.harnessConfig.stack?.testFramework,
      intentSpecOutOfScope,
      projectStateFiles,
    );

    let review: LLMReview;
    let raw: string | undefined;
    try {
      // Amendment 2026-06 — review-agent gains tool access. The
      // per-role default (`readFile`, `searchFiles`) lets the model
      // spot-check files referenced in the artifact set before
      // flagging issues, which produces fewer false positives on
      // big diffs. Falls through to plain `callLLM` when the
      // operator's agents.yaml strips the tools.
      const toolResult = await this.callLLMWithTools(
        prompt,
        agentConfig,
        task.harnessConfig.projectRoot,
        task.correlationId,
      );
      raw = toolResult.response;
      review = parseReview(raw);
    } catch {
      // LLM call or JSON parse failed. Treat as `errored` — the gate
      // verdict treats this as an absence of signals (pass through);
      // the operator sees the error in `agent_executions`.
      return {
        agentRole: 'review-agent',
        status: 'errored',
        signals: [],
        durationMs: Date.now() - startedAt,
        reviewArtifact: null,
      };
    }

    const signals = mapItemsToSignals(task.correlationId, review.items);

    const reviewArtifact: LLMReviewArtifact = {
      id: crypto.randomUUID(),
      correlationId: task.correlationId,
      type: 'design',
      path: `.gestalt/${task.correlationId}/llm-review.md`,
      content: renderReviewMarkdown(review),
      producedBy: 'review-agent',
      createdAt: new Date(),
    };

    return {
      agentRole: 'review-agent',
      status: signals.length === 0 ? 'passed' : 'failed',
      signals,
      durationMs: Date.now() - startedAt,
      reviewArtifact,
    };
  }

  // The base template (`run(AgentTask)`) doesn't apply to the gate
  // layer — review-agent has its own `review(GateTask)` entry point.
  // The abstract methods are stubbed for the same reason as the
  // generate-side agents that override `run()`.
  protected buildPrompt(): string {
    throw new Error('ReviewAgent.buildPrompt is not used — see review(task)');
  }
  protected parseResponse(): AgentResult {
    throw new Error('ReviewAgent.parseResponse is not used — see review(task)');
  }
}

// ─── Prompt + parsing ────────────────────────────────────────────────────────

/**
 * True when the intent text reads as a scaffolding / setup intent.
 * The review-agent suppresses "missing implementation" findings on
 * stub code in that case — operators submitting a "scaffold the
 * project foundation" intent expect skeletons, not finished features,
 * and flagging the missing pieces produces noise that drives the
 * retry budget without yielding better output.
 *
 * Keep the keyword list short and unambiguous — false positives here
 * would let real missing-implementation bugs slip past the review.
 */
const SCAFFOLDING_KEYWORDS = ['scaffold', 'set up', 'setup', 'initialise', 'initialize'];
function detectScaffolding(intentText?: string): boolean {
  if (!intentText) return false;
  const lower = intentText.toLowerCase();
  return SCAFFOLDING_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Reads `HARNESS.json` from the cloned project root and returns the
 * `constraints.rules` array. Returns `[]` for any failure (missing
 * file, malformed JSON, no constraints key) — the prompt simply
 * omits the constraint section in that case.
 */
async function loadConstraintRules(projectRoot: string): Promise<ConstraintRule[]> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      constraints?: { rules?: ConstraintRule[] };
    };
    return parsed.constraints?.rules ?? [];
  } catch {
    return [];
  }
}

/**
 * TEST_REPORT_004 Fix 2 — extract `outOfScope` from the intent-spec
 * artifact (`.gestalt/<correlationId>/intent-spec.json` produced by
 * intent-agent) so the review-agent can be told what NOT to flag.
 * Returns an empty array when the artifact is absent or malformed —
 * the prompt simply omits the section.
 */
function extractIntentSpecOutOfScope(artifacts: ArtifactRef[]): string[] {
  const intentSpecArtifact = artifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/intent-spec.json'),
  );
  if (!intentSpecArtifact) return [];
  try {
    const parsed = JSON.parse(intentSpecArtifact.content) as {
      outOfScope?: unknown;
    };
    if (!Array.isArray(parsed.outOfScope)) return [];
    return parsed.outOfScope.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

/**
 * TEST_REPORT_004 Fix 3 — read the project's key state files
 * (`package.json`, `tsconfig.json`, `AGENTS.md`) from the cloned
 * work-dir so the review-agent can check what's ALREADY on main
 * before flagging "missing X" items. Without this the review-agent
 * had been flagging items that the project already shipped (e.g.
 * "missing @types/pg" on a project whose package.json already
 * declared it) — because the code-agent correctly does NOT
 * regenerate unchanged files, and the review-agent's prompt only
 * saw the cycle's artifacts.
 *
 * Returns the empty object when none of the files exist; the
 * prompt section is then omitted entirely.
 *
 * Content is truncated to 4 KB per file in the prompt builder to
 * keep the input token budget bounded.
 */
async function loadProjectStateFiles(
  projectRoot: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const relPath of ['package.json', 'tsconfig.json', 'AGENTS.md']) {
    try {
      files[relPath] = await readFile(join(projectRoot, relPath), 'utf8');
    } catch {
      // Best-effort — file may not exist on this project.
    }
  }
  return files;
}

function buildReviewPrompt(
  artifacts: ArtifactRef[],
  goldenPrinciples: string[],
  constraintRules: ConstraintRule[],
  agentConfig: AgentConfig,
  isScaffolding: boolean,
  testFramework?: string,
  intentSpecOutOfScope?: string[],
  projectStateFiles?: Record<string, string>,
): string {
  let used = 0;
  const files: string[] = [];
  for (const a of artifacts) {
    if (used > MAX_TOTAL_BYTES) break;
    const slice = a.content.length > MAX_ARTIFACT_BYTES
      ? `${a.content.slice(0, MAX_ARTIFACT_BYTES)}\n/* TRUNCATED */`
      : a.content;
    files.push(`### ${a.path}\n\n\`\`\`\n${slice}\n\`\`\``);
    used += slice.length;
  }

  const persona =
    `You are ${agentConfig.role} working on the Gestalt platform.\n` +
    `Your goal: ${agentConfig.goal}\n`;

  // Project constraint rules from HARNESS.json — checked verbatim by
  // the constraint-agent after generation; flagging them here lets
  // the review-agent emit CONSTRAINT_VIOLATION signals before that
  // pass runs.
  const constraintsSection = constraintRules.length > 0
    ? `\n## Project constraint rules\n\n` +
      `These are the project's automated constraint rules. Check ` +
      `whether the generated code violates any of them. Flag each ` +
      `violation as a separate item with category "architecture" or ` +
      `"security" (whichever fits) and severity matching the rule's ` +
      `severity:\n\n` +
      constraintRules
        .map((r) => `- **${r.id}** (${r.severity}): ${r.description}`)
        .join('\n') +
      `\n`
    : '';

  // Golden principles — already passed in as preformatted strings
  // (one per principle). Surface in full so the review-agent can map
  // each violation to a specific GP id when flagging.
  const principlesSection = goldenPrinciples.length > 0
    ? `\n## Golden principles\n\n` +
      `These are the project's non-negotiable principles. Flag any ` +
      `violations as items with category "golden-principle":\n\n` +
      goldenPrinciples.map((p) => `- ${p}`).join('\n') +
      `\n`
    : '';

  const extensions = agentConfig.promptExtensions.length > 0
    ? `\n\n## Project-specific instructions\n\n${agentConfig.promptExtensions.map((e) => `- ${e}`).join('\n')}\n`
    : '';

  // TEST_REPORT_002 Fix 5 — cross-artifact consistency section. The
  // 2026-06-04 cycle generated Vitest tests against a Jest project +
  // omitted `@types/pg` from package.json; the review-agent verdict
  // was "pass" because the prompt never asked it to look across
  // artifact boundaries. The checks below ARE explicit so the model
  // walks the artifact set with a checklist instead of relying on
  // its own implicit judgment.
  const tf = testFramework?.trim();
  const tfRule = tf
    ? `   The project declares **${tf}** as the test framework (HARNESS.json stack.testFramework). ` +
      `Every test file (under \`tests/\`, \`__tests__/\`, or matching \`*.test.*\` / \`*.spec.*\`) ` +
      `must import from the ${tf} runtime, NOT from any other framework. Flag a mismatch as a ` +
      `CONSTRAINT_VIOLATION with category "architecture", severity "high".`
    : `   If a test file imports from a different framework than the rest of the artifact set ` +
      `declares, flag a CONSTRAINT_VIOLATION.`;

  const consistencySection =
    `\n## Cross-artifact consistency checks\n\n` +
    `You MUST verify these checks across the artifact set. Walk the ` +
    `list explicitly — do not skip a check on the assumption "it's fine".\n\n` +
    `1. **Test framework match.**\n` +
    tfRule +
    `\n\n` +
    `2. **Import resolution.** Every \`import\` statement in every generated file ` +
    `must resolve to either (a) a file present in the artifact set, ` +
    `(b) a declared dependency in package.json (runtime OR dev), or ` +
    `(c) a Node built-in. Flag missing imports as category "bug", severity "high".\n\n` +
    `3. **Type-definition coverage.** Every runtime dependency in package.json ` +
    `that has a well-known \`@types/*\` package on npm must have it listed in ` +
    `devDependencies (express, pg, jsonwebtoken, bcrypt, cors, morgan, ` +
    `supertest, node …). Packages that ship their own types (dotenv, zod, ` +
    `pino, fastify, prisma …) are exempt. Flag missing @types/* as category ` +
    `"architecture", severity "medium".\n\n` +
    `4. **Test file placement.** Test files live under \`tests/unit/\` ` +
    `or \`tests/integration/\`, mirroring the source structure verbatim. ` +
    `**The mirrored sub-directories ARE the correct layout — do NOT flag ` +
    `them.** Worked examples that ARE correct (do not flag):\n` +
    `   - \`src/shared/types/index.ts\` → \`tests/unit/shared/types/index.test.ts\` ✓\n` +
    `   - \`src/shared/db/connection.ts\` → \`tests/unit/shared/db/connection.test.ts\` ✓\n` +
    `   - \`src/modules/leave/leave.service.ts\` → \`tests/unit/modules/leave/leave.service.test.ts\` ✓\n` +
    `   - Repo-root config tests (package.json, tsconfig.json, jest.config.js) ` +
    `→ \`tests/unit/config/<name>.test.ts\` ✓\n\n` +
    `   Only flag a placement violation when a test file is in one of these ` +
    `**genuinely wrong** locations:\n` +
    `   - Inside \`src/\` (co-located with source) — flag as misplaced\n` +
    `   - Under an invented \`src/modules/<config-name>/\` directory for a ` +
    `repo-root config file — flag as misplaced\n` +
    `   - At an arbitrary path like \`test/\`, \`__tests__/\` at the root, ` +
    `or \`spec/\` instead of the project's \`tests/\` convention — flag as ` +
    `misplaced\n\n` +
    `   Mirroring \`src/foo/bar/x.ts\` as \`tests/unit/foo/bar/x.test.ts\` ` +
    `is the **canonical structure** for this project — that IS the rule, ` +
    `not a violation of it. If every test file sits under \`tests/unit/\` ` +
    `with a path that mirrors its source file, return zero placement items. ` +
    `Flag misplaced tests as category "style", severity "low".\n`;

  // Scaffolding mode — when the intent reads as "scaffold / set up /
  // initialise" the model should NOT flag missing implementations or
  // absent RBAC/audit as violations. Stubs are intentional in setup
  // intents. Real security issues (hardcoded secrets, broken logic)
  // still get flagged.
  const scaffoldingSection = isScaffolding
    ? `\n## Scaffolding mode — this intent is a scaffold/setup\n\n` +
      `The operator's intent reads as a scaffolding or setup task. ` +
      `Adjust your review accordingly:\n\n` +
      `- Do NOT flag missing implementations as violations\n` +
      `- Do NOT flag missing RBAC/audit/Zod as GP violations in stub code\n` +
      `- DO still flag: hardcoded secrets, use of \`any\`, obviously broken logic, ` +
      `bad imports, syntax errors\n` +
      `- If everything in the artifacts is intentional skeleton, return ` +
      `overallVerdict: "pass" and an empty items array\n`
    : '';

  // TEST_REPORT_004 Fix 2 — out-of-scope section. Placed BEFORE the
  // golden-principles section so the LLM reads "do NOT flag X" first
  // and applies that exclusion when subsequently considering each
  // golden principle. Without this guard the review-agent
  // extrapolated GP-001 (audit) and GP-003 (input validation) to
  // intents whose outOfScope explicitly excluded the API/audit
  // layers, producing blocking false-positives.
  const outOfScopeSection = (intentSpecOutOfScope && intentSpecOutOfScope.length > 0)
    ? `\n## Out of scope for this intent — do NOT flag these\n\n` +
      `The intent-agent's IntentSpec explicitly lists the following as ` +
      `OUT OF SCOPE for this cycle. Do NOT flag their absence as ` +
      `violations even if they would normally be required by a golden ` +
      `principle:\n\n` +
      intentSpecOutOfScope.map((s) => `- ${s}`).join('\n') + `\n\n` +
      `Concretely: if the intent excludes "API layer" or "API endpoints", ` +
      `do NOT flag missing input validation in route handlers, missing ` +
      `RBAC middleware, or missing audit logging on hypothetical ` +
      `endpoints. If the intent excludes "service layer", do NOT flag ` +
      `missing business-rule enforcement that belongs there. Those ` +
      `concerns belong to a FUTURE intent that includes the excluded ` +
      `layer, not this one.\n` +
      `\n` +
      `Repository-only intents in particular: the repository's job is ` +
      `parameterised SQL + a typed result. Audit logging, input ` +
      `validation at the API boundary, and RBAC enforcement are ` +
      `service / route layer concerns. Do NOT demand them in a ` +
      `repository-only cycle.\n`
    : '';

  // TEST_REPORT_004 Fix 3 — project state section. Lets the
  // review-agent see the project's existing package.json /
  // tsconfig.json / AGENTS.md content so it stops flagging items
  // that are already declared on main. The code-agent correctly
  // does NOT regenerate unchanged files on incremental intents,
  // which previously caused "missing @types/pg" false-positives
  // when the scaffold's package.json already shipped them.
  //
  // Per-file truncation to 4 KB keeps the prompt budget bounded.
  const PROJECT_STATE_TRUNCATE = 4000;
  const projectStateSection = (projectStateFiles && Object.keys(projectStateFiles).length > 0)
    ? `\n## Project state (existing files on main)\n\n` +
      `These files already exist in the project's cloned tree. Use ` +
      `them as the source of truth for what the project ALREADY has. ` +
      `Do NOT flag an item as "missing" if it's present in any of ` +
      `these files — only flag items that are absent from BOTH the ` +
      `cycle's artifact set AND the project state below.\n\n` +
      Object.entries(projectStateFiles)
        .map(([path, content]) => {
          const slice = content.length > PROJECT_STATE_TRUNCATE
            ? `${content.slice(0, PROJECT_STATE_TRUNCATE)}\n/* TRUNCATED — full file is ${content.length} bytes */`
            : content;
          return `### ${path}\n\`\`\`\n${slice}\n\`\`\``;
        })
        .join('\n\n') + `\n`
    : '';

  return `${persona}
You are reviewing code generated by upstream agents. Your job is to
identify concerns the generate layer missed. Be specific and concrete —
no generic advice. Only flag concerns that are actually present in the
code below.
${outOfScopeSection}${projectStateSection}${scaffoldingSection}${constraintsSection}${principlesSection}${consistencySection}
## Files under review

${files.join('\n\n')}

## Instructions

Return ONLY a JSON object (no preamble, no markdown fences) matching this
schema:

{
  "summary": "<2-4 sentence overall judgment>",
  "overallVerdict": "<pass | concerns | block>",
  "items": [
    {
      "file": "<path of the file the concern is in>",
      "line": <1-based line number, or omit if file-wide>,
      "severity": "<critical | high | medium | low | info>",
      "category": "<security | architecture | golden-principle | bug | style>",
      "message": "<one-sentence specific concern>",
      "fixHint": "<one-sentence suggested fix, optional>"
    }
  ]
}

Severity rules:
- critical: security issue with immediate impact (hardcoded secret, unguarded SQL, etc.) — blocks merge
- high: golden-principle breach (missing audit on mutation, RBAC bypass, direct DB call outside repo)
- medium: real bug or architectural drift that should be fixed
- low: minor stylistic or minor consistency issue
- info: observation worth noting, not a problem

If the code is clean, return overallVerdict: "pass" and an empty items array.
${extensions}`;
}

function parseReview(raw: string): LLMReview {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<LLMReview>;
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    overallVerdict: parsed.overallVerdict ?? 'pass',
    items: Array.isArray(parsed.items)
      ? parsed.items.filter((i): i is LLMReviewItem =>
        !!i && typeof i.message === 'string' && typeof i.severity === 'string' && typeof i.category === 'string',
      )
      : [],
  };
}

// ─── Signal mapping ──────────────────────────────────────────────────────────

function mapItemsToSignals(
  correlationId: string,
  items: LLMReviewItem[],
): GateSignal[] {
  const out: GateSignal[] = [];
  for (const item of items) {
    // Only critical / high produce blocking signals. medium → still a
    // CONSTRAINT_VIOLATION so the code-agent can fix it on retry. low/info
    // stay in the artifact only.
    if (item.severity === 'low' || item.severity === 'info') continue;

    // GOLDEN_PRINCIPLE_BREACH triggers `escalate` (human review, never
    // auto-resolved). Reserve it for `critical` severity only.
    const isBreach = item.severity === 'critical';

    out.push({
      id: crypto.randomUUID(),
      correlationId,
      type: isBreach ? 'GOLDEN_PRINCIPLE_BREACH' : 'CONSTRAINT_VIOLATION',
      severity: mapSeverity(item.severity),
      agentRole: 'review-agent',
      message: `[review/${item.category}] ${item.message}${item.fixHint ? ` Hint: ${item.fixHint}` : ''}`,
      location: item.file
        ? { file: item.file, line: item.line, rule: `review/${item.category}` }
        : null,
      autoResolvable: !isBreach,
    });
  }
  return out;
}

function mapSeverity(s: LLMReviewItem['severity']): SignalSeverity {
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

// ─── Artifact rendering ──────────────────────────────────────────────────────

function renderReviewMarkdown(review: LLMReview): string {
  const lines = [
    '# LLM quality-gate review',
    '',
    `**Overall verdict:** ${review.overallVerdict}`,
    '',
    '## Summary',
    '',
    review.summary || '_(no summary)_',
    '',
  ];

  if (review.items.length === 0) {
    lines.push('## Items', '', '_No concerns flagged._', '');
    return lines.join('\n');
  }

  lines.push('## Items', '');
  for (const item of review.items) {
    const loc = item.file
      ? item.line
        ? `${item.file}:${item.line}`
        : item.file
      : '(file-wide)';
    lines.push(`### ${item.severity.toUpperCase()} · ${item.category} · ${loc}`);
    lines.push('');
    lines.push(item.message);
    if (item.fixHint) {
      lines.push('');
      lines.push(`**Suggested fix:** ${item.fixHint}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
