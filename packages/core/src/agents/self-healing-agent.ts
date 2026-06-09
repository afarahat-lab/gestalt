/**
 * SelfHealingAgent (migration 020).
 *
 * The diagnostician for the autonomous self-healing loop. Takes a
 * failure context, asks the LLM to diagnose the root cause, and
 * returns a structured `SelfHealingDiagnosis` the loop uses to
 * decide whether to auto-retry or escalate.
 *
 * The agent extends `BaseLLMAgent` for the standard LLM-call
 * plumbing (model routing via the platform LLM registry, prompt /
 * response capture on the instance, tool-loop support if ever
 * needed). It has no `agents.yaml` config of its own — it carries
 * its own hard-coded persona because the diagnostician role is
 * platform-internal (operators don't tune it).
 *
 * Calls don't throw on parse failure — they return a safe-default
 * diagnosis with `shouldRetry: false, confidence: 'low'` so the
 * loop falls cleanly into human escalation. The brief's invariant
 * "runSelfHealingLoop NEVER throws" depends on this.
 */

import { BaseLLMAgent } from './base-llm-agent';
import type { AgentConfig } from './agent-config';
import { loadAgentConfig } from './agent-config-loader';
import { extractJsonObject } from './json-extract';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'self-healing-agent' });

/**
 * The signal-summary shape persisted on `ResumeContext.priorSignals`.
 * Matches `PlatformSignal` minus the runtime-only fields (`id`,
 * `correlationId`, `autoResolvable`, `resolvedBy`, etc.) so the
 * resume context is compact and self-describing.
 */
interface ResumeSignal {
  type: string;
  message: string;
  sourceAgent: string;
  severity: string;
}

/**
 * Read by `SelfHealingAgent.diagnose`. Mirror of the brief — every
 * field except the optional context blocks (architectureMd / etc.)
 * is required. Optional context lets the loop pass whatever it
 * actually has access to.
 */
export interface SelfHealingContext {
  intentText: string;
  intentSpec?: string;
  failureType: string;
  failureSummary: string;
  technicalDetail?: string;
  attemptNumber: number;
  priorSignals: ResumeSignal[];
  priorArtifactPaths: string[];
  architectureMd?: string;
  domainMd?: string;
  goldenPrinciples?: string;
  constraintRules?: string;
}

/**
 * Queue the loop dispatches the retry on. Lets the diagnostician
 * route a deploy-layer failure to deploy:pr / deploy:pipeline /
 * deploy:promote directly instead of re-running the whole generate
 * cycle. `'none'` is the explicit "I cannot fix this automatically"
 * marker — semantically equivalent to `shouldRetry: false`.
 */
export type SelfHealingRetryTaskType =
  | 'generate:intent'
  | 'deploy:pr'
  | 'deploy:pipeline'
  | 'deploy:promote'
  | 'none';

/**
 * TR_024 (ADR-050) — the diagnostician's routing decision.
 *
 *   - 'retry'      → re-dispatch the original intent on
 *                    `retryTaskType`. Default for code / deploy
 *                    failures that a fresh cycle can fix.
 *   - 'fix-intent' → the failure reveals a SYSTEMIC GAP in the
 *                    project (config, scaffolding, dependency).
 *                    The LLM writes a self-contained Aider-ready
 *                    intent (`fixIntent`) that gets submitted as
 *                    a separate high-priority generate cycle.
 *                    The parent intent resumes automatically
 *                    after the fix's production deploys.
 *   - 'escalate'   → human judgment required.
 *
 * The action is the SOLE routing decision — no `switch` on
 * failure type, no regex on the error string. The LLM evaluates
 * the failure context and picks the action.
 */
export type SelfHealingAction = 'retry' | 'fix-intent' | 'escalate';

export interface SelfHealingDiagnosis {
  diagnosis: string;
  rootCause: string;
  suggestedFix: string;
  /**
   * TR_024 — the diagnostician's routing decision. See
   * `SelfHealingAction` for semantics. Defaults to 'retry' on
   * parse failure to preserve pre-TR_024 behaviour for legacy
   * diagnoses that don't emit the new field.
   */
  action: SelfHealingAction;
  /**
   * TR_024 — when `action === 'fix-intent'`, the complete
   * Aider-ready Gestalt intent text that resolves the systemic
   * gap. Submitted as a separate intent with
   * `source: 'self-healing-fix'`, priority high, and
   * `parent_intent_id` pointing back at the original. Absent /
   * null when action is 'retry' or 'escalate'.
   */
  fixIntent?: string;
  /**
   * TR_024 — operator-facing rationale shown in the dashboard's
   * "Awaiting auto-fix" panel and used as the
   * `[Auto-fix pending] …` prefix on the original intent's
   * resume context. One short paragraph.
   */
  fixIntentRationale?: string;
  /**
   * TR_024 — when true, the platform stores an
   * `onSuccessDispatch` envelope on the fix intent so that
   * after its production promotion the original intent
   * automatically resumes. When false the fix intent is a
   * standalone change and the operator handles resume manually.
   * Defaults to `true` on parse — the common case is "fix the
   * gap, then continue".
   */
  resumeAfterFix?: boolean;
  /**
   * TR_013 — the specific error message, signal, or artifact detail
   * that grounds the diagnosis. Optional (softer than the
   * review-agent / constraint-agent evidence requirement) because the
   * diagnostician reasons over failure context rather than emitting
   * blocking findings — but absent evidence is logged at `warn` level
   * so operators can see when a diagnosis is ungrounded.
   */
  evidenceQuote?: string;
  /** Reframed intent text the orchestrator dispatches as the next cycle. */
  updatedIntentText?: string;
  confidence: 'high' | 'medium' | 'low';
  shouldRetry: boolean;
  /** Agent roles whose output is fine — orchestrator skips on high-confidence retries. */
  skipAgents?: string[];
  /** Files identified as root cause — surfaced in the code-prompt resume section. */
  focusFiles?: string[];
  /**
   * The queue the loop should dispatch the retry on. Lets the
   * diagnostician route a deploy-layer failure straight back to
   * pr-agent / pipeline-agent / promotion-agent instead of forcing
   * a full generate cycle. `'none'` ⇒ treat as `shouldRetry: false`.
   * Defaults to `'generate:intent'` on parse failure so legacy
   * diagnoses still produce a working retry.
   */
  retryTaskType: SelfHealingRetryTaskType;
  /**
   * Free-form hints the diagnostician wants the target agent to
   * apply on the retry. Examples:
   *   pr-agent      — { unshallow, forceWithLease, rebaseBranch, skipArtifactRewrite }
   *   pipeline-agent — { extendTimeout, skipTrigger }
   *   promotion-agent — { skipStagingVerification, retryProductionOnly }
   * Agents apply ONLY hints they recognise; unknown hints are
   * silently ignored so future diagnoses are forward-compatible.
   */
  retryPayloadHints: Record<string, unknown>;
}

const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Hard-coded config for the self-healing agent's LLM call.
 * Platform-internal — operators don't tune this. Temperature 0.1
 * keeps diagnoses deterministic; 2000 tokens is enough for a
 * structured JSON response without over-spending on long prose.
 */
const SELF_HEALING_AGENT_CONFIG: AgentConfig = {
  role: 'Senior software engineer and technical diagnostician',
  goal: 'Diagnose failures and suggest precise fixes for autonomous retry',
  llm: { temperature: 0.1, maxTokens: 2000 },
  promptExtensions: [],
  tools: { builtin: [] },
};

export class SelfHealingAgent extends BaseLLMAgent {
  constructor() { super('self-healing-agent'); }

  /**
   * Produces a `SelfHealingDiagnosis` for the given failure context.
   *
   * Confidence-threshold semantics: the LLM emits its own confidence
   * score, then we DOWNGRADE `shouldRetry` to `false` when that
   * confidence is below the platform-admin's per-failure-type
   * threshold. So a diagnosis the LLM marked `shouldRetry: true,
   * confidence: low` against a `confidenceThreshold: medium`
   * setting will surface as `shouldRetry: false` — the LLM thinks
   * a retry is worth it, but the operator's policy says no.
   *
   * Never throws — LLM-call failure and parse failure both fall
   * through to a safe-default `shouldRetry: false, confidence: low`
   * diagnosis. `runSelfHealingLoop` depends on this for its
   * "NEVER throws" guarantee.
   */
  async diagnose(
    ctx: SelfHealingContext,
    correlationId: string,
    confidenceThreshold: 'high' | 'medium' | 'low' = 'medium',
    /**
     * TR_024 — when provided, the agent loads its model / temperature
     * / prompt_extensions from `<projectRoot>/agents.yaml`'s
     * `self-healing-agent` block. When absent (the common path before
     * TR_024 — the loop has no clone), falls back to the hard-coded
     * SELF_HEALING_AGENT_CONFIG. ADR-050 + ADR-042: operators select
     * the model (e.g. `chat-latest` for the most capable reasoning)
     * via agents.yaml without touching this file.
     */
    projectRoot?: string,
  ): Promise<SelfHealingDiagnosis> {
    const agentConfig = await resolveSelfHealingAgentConfig(projectRoot);
    const prompt = this.buildDiagnosisPrompt(ctx);

    let raw: string;
    try {
      raw = await this.callLLM(prompt, agentConfig, correlationId);
    } catch (err) {
      log.warn(
        { err, correlationId, failureType: ctx.failureType },
        'SelfHealingAgent LLM call failed — returning safe-default',
      );
      return safeDefaultDiagnosis('LLM call failed');
    }

    const diagnosis = this.parseDiagnosis(raw);

    // Apply the per-failure-type confidence threshold: even if the
    // LLM says shouldRetry, downgrade when its own confidence is
    // below the operator's bar.
    if (
      CONFIDENCE_RANK[diagnosis.confidence] < CONFIDENCE_RANK[confidenceThreshold]
    ) {
      diagnosis.shouldRetry = false;
    }

    return diagnosis;
  }

  /**
   * BaseLLMAgent's template `run(task)` is not used — we expose
   * `diagnose(ctx, …)` instead because the input/output shapes
   * don't map onto the standard `AgentTask` / `AgentResult` pair.
   * These stubs satisfy the abstract method declarations.
   */
  protected buildPrompt(): string {
    throw new Error('SelfHealingAgent.buildPrompt is not used — call diagnose() directly');
  }

  protected parseResponse(): unknown {
    throw new Error('SelfHealingAgent.parseResponse is not used — call diagnose() directly');
  }

  private buildDiagnosisPrompt(ctx: SelfHealingContext): string {
    const sections = [
      `You are a senior software engineer diagnosing a failure in an automated code generation pipeline. Analyse the failure and determine if it can be fixed automatically.`,
      `## Original intent\n${ctx.intentText}`,
      buildFailureSection(ctx),
      buildSignalsSection(ctx.priorSignals),
      buildArtifactsSection(ctx.priorArtifactPaths),
      ctx.architectureMd
        ? `## Architecture\n${ctx.architectureMd.slice(0, 1500)}`
        : '',
      ctx.constraintRules ? `## Constraints\n${ctx.constraintRules}` : '',
      ctx.goldenPrinciples ? `## Golden principles\n${ctx.goldenPrinciples}` : '',
      `## Evidence requirement for diagnosis

Your diagnosis must be grounded in the actual failure evidence.
For each claim in your diagnosis, reference the specific error
message, signal, or artifact detail that supports it.

In the "evidenceQuote" field, quote the specific error output or
signal message that led to your diagnosis (verbatim from "Prior
signals" or "Technical detail" above). If multiple signals motivate
the diagnosis, quote the most representative one.

If you cannot ground a claim in the available evidence, state it
as uncertain in the diagnosis prose rather than asserting it as
fact — and leave "evidenceQuote" empty. The orchestrator logs
empty evidenceQuote at warn level so operators can see when a
retry was dispatched without grounding.`,
      `## Available retry task types

Choose the appropriate retryTaskType based on the failure:

- "generate:intent"  — the generated CODE was wrong. Re-run the
  full generate cycle with the fix. Use for: gate failures,
  test failures, lint violations, wrong logic.

- "deploy:pr"        — the CODE is fine but the GIT PUSH failed.
  Retry only the push/commit step. Use for: non-fast-forward errors,
  push rejected, authentication errors, merge conflicts.

- "deploy:pipeline"  — the code and PR are fine but CI didn't run
  or timed out. Re-trigger CI only. Use for: pipeline timeout,
  CI not triggered, transient CI infra error.

- "deploy:promote"   — staging promotion failed but code is fine.
  Retry promotion. Use for: staging gate errors, promotion API errors.

- "none"             — cannot retry automatically. Set when
  shouldRetry is false.

Also include retryPayloadHints — a JSON object with hints for the
target agent. Common hints:
- { "unshallow": true }           — fetch full history before push
- { "forceWithLease": true }      — use --force-with-lease on push
- { "skipArtifactRewrite": true } — don't re-write files, just push
- { "extendTimeout": true }       — wait longer for CI to complete
- { "rebaseBranch": true }        — rebase on default branch before push

## Known failure patterns — use these as reference

GIT PUSH FAILURES → retryTaskType: "deploy:pr"
  "non-fast-forward" | "rejected" | "failed to push":
    hints: { "unshallow": true, "forceWithLease": true }
  "conflict" | "merge conflict":
    hints: { "unshallow": true, "rebaseBranch": true, "forceWithLease": true }
  "authentication failed" | "403" | "permission denied":
    shouldRetry: false  (credentials issue — cannot fix with code)

CI/PIPELINE FAILURES → retryTaskType: "deploy:pipeline"
  "timeout" | "timed out":
    hints: { "extendTimeout": true }
  "did not trigger" | "workflow not found":
    hints: {}  (just re-trigger)
  test failures in CI output:
    retryTaskType: "generate:intent"  (code needs fixing)
    hints: {}

PROMOTION FAILURES → retryTaskType: "deploy:promote"
  "staging gate failed":
    hints: {}
  "production already deployed":
    hints: { "skipStagingVerification": true, "retryProductionOnly": true }

CODE/GATE FAILURES → retryTaskType: "generate:intent"
  Any TypeScript error, lint violation, test failure, constraint violation:
    hints: {}  (generate cycle handles these)

INFRASTRUCTURE FAILURES → shouldRetry: false
  "ECONNREFUSED" | "ETIMEDOUT" | "pnpm: command not found":
    shouldRetry: false, confidence: "low", retryTaskType: "none"

UNRECOVERABLE PLATFORM ERRORS → shouldRetry: false IMMEDIATELY (no retry)
  "invalid input syntax for type uuid"   (postgres 22P02 — bad UUID in DB call)
  "relation does not exist"              (schema migration not applied)
  "column does not exist"                (schema drift)
  "password authentication failed"       (DB credentials wrong)
    shouldRetry: false, confidence: "high", retryTaskType: "none"
    These are operator-only fixes — never burn a retry on them.

## Action routing (TR_024 — ADR-050)

Pick exactly one ACTION. The platform's routing logic is a
direct deterministic consequence of YOUR decision — there is no
hardcoded failure-pattern matching. Choose:

- "retry"      — the failure is in the generated code or a
  deployment step. A fresh attempt with adjusted context will
  fix it. This is the default. Set shouldRetry=true and pick
  retryTaskType.

- "fix-intent" — the failure reveals a GAP IN THE PROJECT that
  will cause the same error on every retry. The project itself
  needs to be fixed FIRST. Examples: tsconfig missing a flag,
  package.json missing a dependency, a scaffold file with the
  wrong shape, an environment variable not wired up.
  When you pick this action you MUST also produce a
  fixIntent — a complete, self-contained Aider-ready Gestalt
  intent text that fixes the gap. The platform submits it as a
  separate high-priority generate cycle; the original intent
  resumes automatically after the fix deploys (if
  resumeAfterFix=true).

- "escalate"   — the failure requires human judgment, is
  caused by external infrastructure (network, credentials,
  upstream service), or you cannot determine the root cause
  with confidence. Set shouldRetry=false and retryTaskType=none.

When writing a fixIntent:
- It must be a complete, self-contained Gestalt intent — Aider
  reads it verbatim
- It must reference exact file paths
- It must be narrow in scope — fix ONLY the gap, not the
  surrounding feature
- It will be submitted as source self-healing-fix with
  priority high

## Your task
Return ONLY a JSON object — no preamble, no markdown fences:
{
  "diagnosis": "What went wrong",
  "rootCause": "Underlying technical reason",
  "action": "retry|fix-intent|escalate",
  "suggestedFix": "Specific actionable fix description",
  "fixIntent": "if action is fix-intent: describe the CONTEXT and FAILURE that needs resolving. Include the CI error text, which files are involved, and what the code was trying to do. Do NOT write prescriptive instructions telling Aider what code to write. Provide context — let Aider decide the fix. Example WRONG: 'Update LeaveRequest to add reason field' Example CORRECT: 'CI failed: TS2339 Property reason does not exist on LeaveRequest. The service references this.request.reason but leave.model.ts does not define it. Analyse and fix.'",
  "fixIntentRationale": "if action=fix-intent: one paragraph explaining why this fix is needed and what it prevents. Omit / null otherwise.",
  "resumeAfterFix": true,
  "evidenceQuote": "verbatim error/signal text that grounds the diagnosis (empty if none)",
  "updatedIntentText": "Reframed intent if needed (optional)",
  "confidence": "high|medium|low",
  "shouldRetry": true|false,
  "skipAgents": ["agent-roles whose output is fine and can be skipped"],
  "focusFiles": ["specific files that need regenerating"],
  "retryTaskType": "generate:intent|deploy:pr|deploy:pipeline|deploy:promote|none",
  "retryPayloadHints": { /* hint object — see above */ }
}

Set shouldRetry=false and retryTaskType="none" when:
- The failure is infrastructure/credentials — code cannot fix it
- You cannot determine the root cause from available context
- The same error has clearly appeared multiple times without progress
- action is "fix-intent" (the fix-intent is the recovery, not a retry of the parent)
- action is "escalate"`,
    ];
    return sections.filter(Boolean).join('\n\n');
  }

  private parseDiagnosis(raw: string): SelfHealingDiagnosis {
    try {
      const json = extractJsonObject(raw);
      const parsed = JSON.parse(json) as Partial<SelfHealingDiagnosis>;
      // TR_013 — soft evidence requirement. Missing or empty
      // `evidenceQuote` is logged at warn level (not dropped) because
      // the self-healing agent diagnoses rather than emits blocking
      // findings — a diagnosis without a grounding quote is allowed
      // to drive a retry, but operators see the warning when one
      // slips through.
      const evidenceQuote =
        typeof parsed.evidenceQuote === 'string' && parsed.evidenceQuote.trim() !== ''
          ? parsed.evidenceQuote
          : undefined;
      if (!evidenceQuote) {
        log.warn(
          {
            diagnosisPrefix: (parsed.diagnosis ?? '').slice(0, 80),
            confidence: parsed.confidence,
          },
          'SelfHealingAgent diagnosis missing evidenceQuote — accepted, but ungrounded',
        );
      }
      // TR_024 — action routes the loop. Pre-TR_024 diagnoses
      // didn't emit this field; we infer the action from the legacy
      // shouldRetry flag so older deployments keep working without a
      // schema migration on the LLM side.
      const inferredAction: SelfHealingAction =
        parsed.action === 'fix-intent' || parsed.action === 'escalate' || parsed.action === 'retry'
          ? parsed.action
          : parsed.shouldRetry === false
            ? 'escalate'
            : 'retry';
      const fixIntent =
        typeof parsed.fixIntent === 'string' && parsed.fixIntent.trim() !== ''
          ? parsed.fixIntent
          : undefined;
      const fixIntentRationale =
        typeof parsed.fixIntentRationale === 'string' && parsed.fixIntentRationale.trim() !== ''
          ? parsed.fixIntentRationale
          : undefined;
      const resumeAfterFix =
        typeof parsed.resumeAfterFix === 'boolean' ? parsed.resumeAfterFix : true;
      return {
        diagnosis: typeof parsed.diagnosis === 'string' ? parsed.diagnosis : 'Unknown failure',
        rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'Unknown',
        suggestedFix: typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix : 'Manual review required',
        action: inferredAction,
        fixIntent,
        fixIntentRationale,
        resumeAfterFix,
        evidenceQuote,
        updatedIntentText:
          typeof parsed.updatedIntentText === 'string' && parsed.updatedIntentText.trim() !== ''
            ? parsed.updatedIntentText
            : undefined,
        confidence: isConfidence(parsed.confidence) ? parsed.confidence : 'low',
        shouldRetry: typeof parsed.shouldRetry === 'boolean' ? parsed.shouldRetry : false,
        skipAgents: Array.isArray(parsed.skipAgents)
          ? parsed.skipAgents.filter((s): s is string => typeof s === 'string')
          : [],
        focusFiles: Array.isArray(parsed.focusFiles)
          ? parsed.focusFiles.filter((s): s is string => typeof s === 'string')
          : [],
        // Default to 'generate:intent' on parse — preserves the
        // pre-Option-B behaviour for older diagnoses that don't
        // emit the new field. Explicit 'none' means
        // shouldRetry=false (caller treats them identically).
        retryTaskType: isRetryTaskType(parsed.retryTaskType)
          ? parsed.retryTaskType
          : 'generate:intent',
        // Defensive: only accept a plain object. Future hints
        // added by newer diagnoses pass through; agents apply
        // only what they recognise.
        retryPayloadHints:
          parsed.retryPayloadHints !== null &&
          typeof parsed.retryPayloadHints === 'object' &&
          !Array.isArray(parsed.retryPayloadHints)
            ? (parsed.retryPayloadHints as Record<string, unknown>)
            : {},
      };
    } catch (err) {
      log.warn({ err }, 'SelfHealingAgent JSON parse failed — returning safe-default');
      return safeDefaultDiagnosis('parse failure');
    }
  }
}

function buildFailureSection(ctx: SelfHealingContext): string {
  const lines = [
    '## Failure details',
    `Type: ${ctx.failureType}`,
    `Summary: ${ctx.failureSummary}`,
  ];
  if (ctx.technicalDetail) {
    lines.push(`Technical detail: ${ctx.technicalDetail}`);
  }
  lines.push(`Attempt: ${ctx.attemptNumber}`);
  return lines.join('\n');
}

function buildSignalsSection(signals: ResumeSignal[]): string {
  if (signals.length === 0) {
    return '## Prior signals (0)\nNone';
  }
  return `## Prior signals (${signals.length})\n${signals
    .map((s) => `- [${s.type}/${s.severity}] ${s.sourceAgent}: ${s.message}`)
    .join('\n')}`;
}

function buildArtifactsSection(paths: string[]): string {
  const heading = '## Generated files before failure';
  if (paths.length === 0) {
    return `${heading}\nNone yet`;
  }
  return `${heading}\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

function isConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isRetryTaskType(value: unknown): value is SelfHealingRetryTaskType {
  return (
    value === 'generate:intent' ||
    value === 'deploy:pr' ||
    value === 'deploy:pipeline' ||
    value === 'deploy:promote' ||
    value === 'none'
  );
}

/**
 * TR_024 — resolve the LLM config for the self-healing agent.
 *
 *   - `projectRoot` provided + `agents.yaml` has a
 *     `self-healing-agent` block → operator's choice wins (model,
 *     temperature, max_tokens, prompt_extensions).
 *   - `projectRoot` provided + block absent → loader returns the
 *     platform default (which has no entry yet today, but
 *     loadAgentConfig falls through cleanly).
 *   - `projectRoot` absent → the hard-coded SELF_HEALING_AGENT_CONFIG
 *     is the safe fallback for callers that have no clone (e.g.
 *     the auto-resolve path inside the loop).
 *
 * Never throws — every failure falls through to the hardcoded
 * config. `runSelfHealingLoop`'s "NEVER throws" guarantee depends
 * on this.
 */
async function resolveSelfHealingAgentConfig(projectRoot?: string): Promise<AgentConfig> {
  if (!projectRoot) return SELF_HEALING_AGENT_CONFIG;
  try {
    return await loadAgentConfig(projectRoot, 'self-healing-agent');
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'loadAgentConfig(self-healing-agent) threw — using hard-coded fallback',
    );
    return SELF_HEALING_AGENT_CONFIG;
  }
}

function safeDefaultDiagnosis(reason: string): SelfHealingDiagnosis {
  return {
    diagnosis: `Could not produce a diagnosis — ${reason}`,
    rootCause: 'Unknown',
    suggestedFix: 'Manual review required',
    // Safe-default: escalate. With no diagnosis we cannot pick a
    // retry queue OR write a sensible fix intent.
    action: 'escalate',
    confidence: 'low',
    shouldRetry: false,
    skipAgents: [],
    focusFiles: [],
    retryTaskType: 'none',
    retryPayloadHints: {},
  };
}
