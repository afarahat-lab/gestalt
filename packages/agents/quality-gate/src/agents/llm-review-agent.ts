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
import { loadAgentConfig, BaseLLMAgent } from '@gestalt/agents-generate';
import type { AgentConfig, AgentResult } from '@gestalt/agents-generate';

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

    const prompt = buildReviewPrompt(
      codeArtifacts,
      task.harnessConfig.goldenPrinciples,
      projectRules,
      agentConfig,
      isScaffolding,
    );

    let review: LLMReview;
    let raw: string | undefined;
    try {
      raw = await this.callLLM(prompt, agentConfig, task.correlationId);
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
      path: `.gestalt/llm-review-${task.correlationId.slice(0, 8)}.md`,
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

function buildReviewPrompt(
  artifacts: ArtifactRef[],
  goldenPrinciples: string[],
  constraintRules: ConstraintRule[],
  agentConfig: AgentConfig,
  isScaffolding: boolean,
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

  return `${persona}
You are reviewing code generated by upstream agents. Your job is to
identify concerns the generate layer missed. Be specific and concrete —
no generic advice. Only flag concerns that are actually present in the
code below.
${scaffoldingSection}${constraintsSection}${principlesSection}
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
  const clean = raw.replace(/```json|```/g, '').trim();
  // Some models wrap the JSON in surrounding prose. Find the outermost {...}.
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  const body = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  const parsed = JSON.parse(body) as Partial<LLMReview>;
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
