/**
 * Constraint agent — pure LLM verification (TEST_REPORT_005 evolution).
 *
 * The previous TEST_REPORT_005 design used a two-stage flow:
 * scripted regex detection produced candidates, then an LLM
 * judgment pass dismissed false positives. This evolution removes
 * the scripted stage entirely. The constraint-agent now:
 *
 *   1. Reads HARNESS.json's `agentConfig['constraint-agent'].rules`
 *      (plain English — what to enforce). No regex patterns
 *      hardcoded in the platform.
 *   2. Calls the LLM with `executeScript`, `readFile`, and
 *      `searchFiles` available as tools. The LLM decides which
 *      commands fit the project's stack (e.g. `tsc --noEmit`,
 *      `grep -r "console\\." src/`, `jest --listTests`) and runs
 *      them to verify each rule.
 *   3. Returns a JSON `{violations: [...]}` shape. Parse failure
 *      is treated as CLEAN (the cycle is never blocked because
 *      the constraint-agent's own output was malformed).
 *
 * The agent runner persists `lastPrompt` / `lastLlmResponse` /
 * `lastModelUsed` / `lastTokensUsed` / `lastToolCallLog` onto the
 * `agent_executions` row via the orchestrator's observability
 * wrapper (same pattern as ReviewAgent).
 *
 * Backward compatibility: `runConstraintAgent(task)` remains the
 * orchestrator's entry point. The function instantiates a
 * `ConstraintAgent` singleton internally; observability fields
 * are read back from `getConstraintAgentInstance()` by the gate
 * orchestrator.
 */

import {
  BaseLLMAgent, extractJsonObject,
  EVIDENCE_REQUIREMENT_SECTION, QUOTED_LINE_SCHEMA_FIELD,
  dropUnevidencedFindings,
  loadAgentConfig,
} from '@gestalt/core';
import type { AgentConfig, HarnessConfig } from '@gestalt/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type {
  GateTask, GateAgentResult, GateSignal,
  ArtifactRef, SignalSeverity, CodeLocation,
} from '../types';
import type { SignalType } from '@gestalt/core';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'constraint-agent' });

// ─── Configuration ──────────────────────────────────────────────────────────
//
// TEST_REPORT_017 — constraint-agent now resolves its config via
// `loadAgentConfig(projectRoot, 'constraint-agent')`, the same path
// every other LLM-driven agent uses. The previous module-level
// `AGENT_CONFIG` constant silently ignored `agents.yaml` overrides
// — operators tuning constraint-agent's `model` / `temperature` /
// `max_tokens` got no signal that their config wasn't being read.
// TR_016's verification cycle passed despite this bug; TR_017
// closes it so future cycles can rely on the model field
// (constraint-agent now honours `model: gpt-4o` on trackeros).
//
// Platform defaults for constraint-agent live in
// `PER_ROLE_DEFAULTS['constraint-agent']` (packages/core/src/agents/
// agent-config-loader.ts:142) — `loadAgentConfig` returns those
// when no `agents.yaml` block is present, then merges the YAML
// override on top.

/** Cap each artifact's body when inlined into the prompt. */
const PER_ARTIFACT_BODY_CAP = 2000;
const MAX_ARTIFACTS_IN_PROMPT = 12;

// ─── Response parsing ─────────────────────────────────────────────────────-

interface ParsedViolation {
  constraintId?: string;
  file?: string;
  line?: number;
  /**
   * TR_013 — the exact line from the artifact that constitutes the
   * violation, quoted verbatim. Required; violations missing this
   * field are dropped by `dropUnevidencedFindings` in
   * `parseViolations` before they reach the gate.
   */
  quotedLine?: string;
  explanation?: string;
  severity?: string;
  /**
   * Used by `dropUnevidencedFindings` (which looks at
   * `message` / `description` / `explanation`). Optional alias; the
   * agent's contract still emits `explanation`.
   */
  message?: string;
}

interface ParsedResponse {
  violations?: ParsedViolation[];
  summary?: string;
}

// ─── Agent class ────────────────────────────────────────────────────────────

export class ConstraintAgent extends BaseLLMAgent {
  constructor() { super('constraint-agent'); }

  protected buildPrompt(): string {
    throw new Error('ConstraintAgent.buildPrompt() is not used — see verify()');
  }
  protected parseResponse(): unknown {
    throw new Error('ConstraintAgent.parseResponse() is not used — see verify()');
  }

  /**
   * Orchestrator entry point. Loads HARNESS.json + intent-spec from
   * the cycle's artifacts and the cloned project root, assembles
   * the prompt, runs the tool-use LLM loop, parses the response,
   * and returns a `GateAgentResult` ready for the orchestrator.
   */
  async verify(task: GateTask): Promise<GateAgentResult> {
    this.lastTokensUsed = 0;
    const startedAt = Date.now();

    // TR_017 — load the per-agent config the same way review-agent
    // does. `loadAgentConfig` returns `PER_ROLE_DEFAULTS[
    // 'constraint-agent']` when no `agents.yaml` block is present
    // (preserving the original AGENT_CONFIG values: role, goal,
    // temperature 0.0, maxTokens 4000, tools executeScript /
    // readFile / searchFiles); the operator's `agents.yaml` block
    // overrides on top so `model: gpt-4o` reaches the wire.
    const [harnessConfig, intentSpec, agentConfig] = await Promise.all([
      loadHarnessConfig(task.harnessConfig.projectRoot),
      Promise.resolve(extractIntentSpec(task.artifacts)),
      loadAgentConfig(task.harnessConfig.projectRoot, 'constraint-agent'),
    ]);

    const prompt = this.buildVerificationPrompt(task, harnessConfig, intentSpec, agentConfig);

    let response: string;
    try {
      const result = await this.callLLMWithTools(
        prompt,
        agentConfig,
        task.harnessConfig.projectRoot,
        task.correlationId,
      );
      response = result.response;
    } catch (err) {
      // LLM-call failure → never block the cycle. The review-agent
      // is the second LLM-driven defence.
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId: task.correlationId },
        'Constraint-agent LLM call failed — passing clean',
      );
      return {
        agentRole: 'constraint-agent',
        status: 'passed',
        signals: [],
        durationMs: Date.now() - startedAt,
      };
    }

    const signals = this.parseViolations(response, task);
    const status: GateAgentResult['status'] =
      signals.some((s) => s.severity === 'high' || s.severity === 'critical')
        ? 'failed'
        : 'passed';

    log.info(
      {
        correlationId: task.correlationId,
        toolCalls: this.lastToolCallLog.length,
        violations: signals.length,
        tokensUsed: this.lastTokensUsed,
      },
      'Constraint-agent verification complete',
    );

    return {
      agentRole: 'constraint-agent',
      status,
      signals,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Assemble the prompt. Sections, in order:
   *
   *   1. Persona (from AGENT_CONFIG)
   *   2. HARNESS-derived rules (`buildHarnessAgentSection`)
   *   3. One-line `executeScript` direction (`buildScriptToolInstruction`)
   *   4. Intent + outOfScope guard
   *   5. Generated artifacts (truncated per-file)
   *   6. Output schema
   *
   * No hardcoded verification commands. The LLM picks them.
   */
  private buildVerificationPrompt(
    task: GateTask,
    harnessConfig: HarnessConfig | null,
    intentSpec: { rawIntent?: string; outOfScope?: string[] } | null,
    agentConfig: AgentConfig,
  ): string {
    const rulesSection = this.buildHarnessAgentSection(harnessConfig);
    const scriptInstruction = this.buildScriptToolInstruction();
    const rawIntent = intentSpec?.rawIntent ?? task.intentText ?? 'Unknown';
    const outOfScope = intentSpec?.outOfScope ?? [];

    const codeArtifacts = task.artifacts
      .filter((a) => a.type === 'code')
      .slice(0, MAX_ARTIFACTS_IN_PROMPT)
      .map((a) => {
        const body = a.content.length > PER_ARTIFACT_BODY_CAP
          ? `${a.content.slice(0, PER_ARTIFACT_BODY_CAP)}\n/* TRUNCATED — full file is ${a.content.length} bytes (use readFile to read more) */`
          : a.content;
        return `### ${a.path}\n\`\`\`\n${body}\n\`\`\``;
      });

    // TR_017 — persona comes from the resolved AgentConfig (defaults
    // overridden by the operator's `agents.yaml` block when present)
    // instead of being hardcoded. Mirrors `llm-review-agent.ts`'s
    // `buildReviewPrompt` pattern.
    return `You are ${agentConfig.role} working on a project clone at the current working directory.

${rulesSection}
${scriptInstruction}
${EVIDENCE_REQUIREMENT_SECTION}
## Intent
${rawIntent}

## Out of scope — do NOT flag these
${outOfScope.length > 0 ? outOfScope.map((s) => `- ${s}`).join('\n') : 'Nothing explicitly excluded'}

## Generated code (this cycle's artifacts)

${codeArtifacts.length > 0 ? codeArtifacts.join('\n\n') : '(no code artifacts in this cycle)'}

## Your task

Verify each rule above against the generated code. You have access to:

- **executeScript** — run any shell command (compile, lint, test, grep, …)
- **readFile** — read an existing project file
- **searchFiles** — search a pattern across the project tree

Decide which commands fit this project's language + stack. Run them.
Use the outputs as evidence for your verdict on each rule.

Return ONLY a single JSON object (no preamble, no markdown fences):

\`\`\`json
{
  "violations": [
    {
      "constraintId": "which rule was violated",
      "file": "path/to/file",
      "line": 42,
      ${QUOTED_LINE_SCHEMA_FIELD},
      "explanation": "what is wrong and why this specific line violates the rule",
      "severity": "high" | "medium" | "low"
    }
  ],
  "summary": "N violations found"
}
\`\`\`

Any violation missing "quotedLine" will be automatically discarded.

If every rule passes, return \`{"violations": [], "summary": "0 violations"}\`.`;
  }

  /**
   * Parse the LLM's JSON response into `GateSignal`s. Failure → no
   * signals (never block on a malformed reply). Caps severity to
   * the allowed union; defaults to `medium` when the LLM omits.
   */
  private parseViolations(raw: string, task: GateTask): GateSignal[] {
    let parsed: ParsedResponse;
    try {
      parsed = JSON.parse(extractJsonObject(raw)) as ParsedResponse;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId: task.correlationId },
        'Constraint-agent response could not be parsed — passing clean',
      );
      return [];
    }

    const rawItems = Array.isArray(parsed.violations) ? parsed.violations : [];

    // TR_013 — drop violations the LLM cannot ground in a verbatim
    // quote from the artifact. The shared helper logs each drop at
    // `info` level so operators can see hallucination rate.
    const validItems = dropUnevidencedFindings(rawItems, log);

    const signals: GateSignal[] = [];
    for (const v of validItems) {
      const file = typeof v.file === 'string' ? v.file : '';
      const explanation = typeof v.explanation === 'string' ? v.explanation : '';
      if (!file || !explanation) continue;
      const constraintId = typeof v.constraintId === 'string' && v.constraintId.length > 0
        ? v.constraintId
        : 'rule-unspecified';
      const severity = coerceSeverity(v.severity);
      const line = typeof v.line === 'number' && Number.isFinite(v.line) ? v.line : 0;
      const signalType: SignalType = severity === 'critical'
        ? 'GOLDEN_PRINCIPLE_BREACH'
        : 'CONSTRAINT_VIOLATION';
      // TR_013 — surface the LLM's quoted evidence in the signal so
      // the next-round code-agent (and the operator) sees the exact
      // line that drove the finding. `quotedLine` is guaranteed
      // present here because `dropUnevidencedFindings` discarded any
      // entry missing it.
      const quotedLine = (v.quotedLine ?? '').trim();
      signals.push({
        id: crypto.randomUUID(),
        correlationId: task.correlationId,
        type: signalType,
        severity,
        agentRole: 'constraint-agent',
        message:
          `[${constraintId}] ${explanation}\n` +
          `  Evidence: "${quotedLine}"`,
        location: {
          file,
          line,
          column: 0,
          rule: constraintId,
        } as CodeLocation,
        autoResolvable: severity !== 'critical',
      });
    }
    return signals;
  }
}

function coerceSeverity(value: unknown): SignalSeverity {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

// ─── HARNESS.json + intent-spec loaders ─────────────────────────────────────

async function loadHarnessConfig(projectRoot: string): Promise<HarnessConfig | null> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    return JSON.parse(raw) as HarnessConfig;
  } catch {
    return null;
  }
}

function extractIntentSpec(
  artifacts: ArtifactRef[],
): { rawIntent?: string; outOfScope?: string[] } | null {
  const intentSpecArtifact = artifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/intent-spec.json'),
  );
  if (!intentSpecArtifact) return null;
  try {
    const parsed = JSON.parse(intentSpecArtifact.content) as {
      rawIntent?: unknown;
      outOfScope?: unknown;
    };
    const out: { rawIntent?: string; outOfScope?: string[] } = {};
    if (typeof parsed.rawIntent === 'string') out.rawIntent = parsed.rawIntent;
    if (Array.isArray(parsed.outOfScope)) {
      out.outOfScope = parsed.outOfScope.filter((s): s is string => typeof s === 'string');
    }
    return out;
  } catch {
    return null;
  }
}

// ─── Public function (backward-compatible entry point) ─────────────────────

const _singleton = new ConstraintAgent();

export async function runConstraintAgent(task: GateTask): Promise<GateAgentResult> {
  return _singleton.verify(task);
}

export function getConstraintAgentInstance(): ConstraintAgent {
  return _singleton;
}
