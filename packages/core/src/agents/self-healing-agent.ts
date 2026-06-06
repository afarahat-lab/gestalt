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

export interface SelfHealingDiagnosis {
  diagnosis: string;
  rootCause: string;
  suggestedFix: string;
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
  ): Promise<SelfHealingDiagnosis> {
    const prompt = this.buildDiagnosisPrompt(ctx);

    let raw: string;
    try {
      raw = await this.callLLM(prompt, SELF_HEALING_AGENT_CONFIG, correlationId);
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

## Your task
Return ONLY a JSON object — no preamble, no markdown fences:
{
  "diagnosis": "What went wrong",
  "rootCause": "Underlying technical reason",
  "suggestedFix": "Specific actionable fix description",
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
- The same error has clearly appeared multiple times without progress`,
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
      return {
        diagnosis: typeof parsed.diagnosis === 'string' ? parsed.diagnosis : 'Unknown failure',
        rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'Unknown',
        suggestedFix: typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix : 'Manual review required',
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

function safeDefaultDiagnosis(reason: string): SelfHealingDiagnosis {
  return {
    diagnosis: `Could not produce a diagnosis — ${reason}`,
    rootCause: 'Unknown',
    suggestedFix: 'Manual review required',
    confidence: 'low',
    shouldRetry: false,
    skipAgents: [],
    focusFiles: [],
    // Safe-default: cannot retry automatically.
    retryTaskType: 'none',
    retryPayloadHints: {},
  };
}
