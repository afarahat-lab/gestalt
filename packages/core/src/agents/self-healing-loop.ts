/**
 * Self-healing loop (migration 020).
 *
 * The brain of the autonomous self-healing feature. Wraps every
 * failure path in a uniform invocation pattern:
 *
 *   const result = await runSelfHealingLoop(ctx, payload, signals);
 *   if (result.shouldRetry) dispatch(generate:intent, { source: 'self-healing', ... });
 *   else if (!result.escalated) transition(failed);
 *   // if escalated: alert already created + auto-resolve already attempted
 *
 * Two-stage resolution:
 *   1. Budget check + SelfHealingAgent diagnosis. If `shouldRetry`
 *      and budget remaining, save resume context + increment
 *      attempt counter, return `shouldRetry: true`. Caller dispatches.
 *   2. Otherwise escalate: create the failure alert AND
 *      (if `autoResolveAlerts: true` in config) re-invoke the
 *      diagnostician at high confidence in an attempt to fix the
 *      alert without operator input.
 *
 * Invariants:
 *   - NEVER throws. Every code path catches and falls back to
 *     human escalation.
 *   - `attemptAutoResolveAlert` NEVER throws — the alert remains
 *     open if auto-resolve fails, non-fatal.
 *   - `skipAgents` only applied when confidence === 'high' (the
 *     diagnostician enforces this inside `diagnose()` via its
 *     confidence-threshold downgrade; we additionally clear the
 *     list when shouldRetry was downgraded).
 */

import {
  SelfHealingAgent,
  type SelfHealingContext,
  type SelfHealingDiagnosis,
  type SelfHealingRetryTaskType,
} from './self-healing-agent';
import type {
  PlatformSignal, AgentRole,
} from '../types';
import { getRepositories } from '../repository/index';
import type {
  ResumeContext, SelfHealingConfigRecord, AlertType, AlertRequiredAction,
} from '../repository/index';
import { dispatch, getQueueConfig } from '../queue/index';
import { eventBus } from '../events/index';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'self-healing-loop' });

/**
 * Substrings that mark a failure as fundamentally not fixable by a
 * retry. Fix C — `docs/claude/TEST_REPORT_001.md`. When the
 * orchestrator's `failureSummary` (or any captured `technicalDetail`)
 * contains one of these patterns, the loop short-circuits straight
 * to escalation without burning an LLM call on a diagnosis that can
 * only conclude "retry won't help."
 *
 * Treat the list as conservative — only patterns whose recovery
 * strictly requires operator action (schema migration, credential
 * fix, infrastructure repair). Don't include transient errors here.
 */
const UNRECOVERABLE_ERROR_PATTERNS: readonly string[] = [
  'invalid input syntax for type uuid',  // postgres 22P02
  'relation does not exist',             // missing table / view
  'column does not exist',               // schema drift
  'econnrefused',                        // DB / Redis / upstream down
  'password authentication failed',      // bad DB credentials
];

export function isUnrecoverableError(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return UNRECOVERABLE_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * TR_025 — maximum allowed depth of `parent_intent_id` chain
 * BEFORE the platform refuses to spawn another fix-intent.
 *
 * Depth 0 = a human-submitted (or planning-submitted) intent has
 *           no parent. The diagnostician is free to pick fix-intent.
 * Depth 1 = the intent is itself a fix-intent (its parent is the
 *           original). Still allowed to spawn another fix-intent
 *           if its own CI uncovers a different gap.
 * Depth 2 = the intent is a fix-of-a-fix. The diagnostician's next
 *           "fix-intent" decision is force-escalated to a human
 *           alert instead.
 *
 * Rationale: ADR-050 says the LLM owns the action choice. The
 * platform doesn't override the choice; it sets a hard ceiling on
 * recursion in the same spirit as MAX_GATE_RETRIES (which the LLM
 * doesn't get to override either). TR_024's verification cycle
 * observed a 3-deep runaway when the same CI error repeated
 * across attempts — this brake closes that loop.
 */
const MAX_FIX_INTENT_DEPTH = 2;

/**
 * TR_025 — walk the `parent_intent_id` chain upward from
 * `intentId` and return its depth. 0 means the intent has no
 * parent (it's a human / planning submission). 1 means it's a
 * fix-intent of an original. Higher values mean fix-of-fix.
 *
 * Bounded to 10 hops as a safety belt against an accidental
 * parent_intent_id cycle in the DB — the FK + ON DELETE SET NULL
 * shouldn't permit one, but a defensive cap costs nothing.
 *
 * NEVER throws — every error path logs and returns the depth
 * walked so far, so the loop continues making sensible decisions.
 */
async function getFixIntentChainDepth(
  intentId: string,
  repos: ReturnType<typeof getRepositories>,
): Promise<number> {
  let depth = 0;
  let currentId: string | null = intentId;
  while (depth < 10 && currentId) {
    try {
      const intent = await repos.intents.findById(currentId);
      if (!intent?.parentIntentId) break;
      depth += 1;
      currentId = intent.parentIntentId;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), intentId: currentId },
        'getFixIntentChainDepth lookup failed — returning walked-so-far depth',
      );
      break;
    }
  }
  return depth;
}

/**
 * Fix G — strip trailing punctuation (period, exclamation, question
 * mark) + whitespace from the diagnosis before concatenating with
 * `Confidence:`. The LLM frequently terminates with a period, and
 * the template then adds its own — producing `…syntax.. Confidence`.
 */
function stripTrailingPunctuation(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/[.!?\s]+$/u, '');
}

/**
 * TEST_REPORT_004 Fix 4 — compare the current attempt's signals to
 * the prior attempt's signals (carried on
 * `intent.lastResumeContext.priorSignals`) and return the subset of
 * current signals whose `(type, first-N-chars-of-message)` tuple was
 * NOT present before. Those are the violations the diagnostician's
 * amendment introduced — escalation rather than another amendment
 * is the correct response.
 *
 * Comparing only `type` would be too coarse (a single rule firing on
 * a different line shouldn't count as "new"). Comparing message
 * verbatim is too strict (line numbers / file names change between
 * attempts). The compromise is `type` + first 60 chars of the
 * message — long enough to distinguish different rule firings on
 * the same rule, short enough to tolerate path differences.
 */
const SIGNAL_FINGERPRINT_PREFIX = 60;
function signalFingerprint(s: { type: string; message: string }): string {
  return `${s.type}|${s.message.slice(0, SIGNAL_FINGERPRINT_PREFIX)}`;
}

function detectRetryIntroducedViolations(
  currentSignals: PlatformSignal[],
  priorSignals: ReadonlyArray<{ type: string; message: string; sourceAgent: string; severity: string }>,
): PlatformSignal[] {
  if (priorSignals.length === 0) return [];
  const priorFingerprints = new Set(priorSignals.map(signalFingerprint));
  return currentSignals.filter((s) => !priorFingerprints.has(signalFingerprint(s)));
}

/**
 * TEST_REPORT_012 Fix 3 — detect review-agent hallucination loops.
 *
 * TR_011's 8-round cycle proved the gate's failure mode is structural:
 * review-agent emits the same false-positive findings every round
 * regardless of whether the code-agent's amendment addressed them, the
 * code-agent re-emits valid code, and the cycle still fails the gate.
 * Each round burns ~300k tokens chasing phantom complaints.
 *
 * This check is the brake. When >50% of the current attempt's signals
 * (by fingerprint) match the prior attempt's signals AND we're past the
 * first attempt, the loop is non-productive: the code hasn't changed
 * meaningfully but the gate keeps failing on the same things. Escalate
 * to human review rather than burning another retry round.
 *
 * The 50% threshold is conservative — a single repeated finding amongst
 * many new ones doesn't trip the brake (the amendment is making
 * progress, just slowly). Use the higher-precision fingerprint
 * (`type | first-N-chars-of-message`) so a finding re-rendered with a
 * different line number still matches.
 */
const REPEATED_SIGNAL_THRESHOLD = 0.5;

function detectRepeatedSignalLoop(
  currentSignals: PlatformSignal[],
  priorSignals: ReadonlyArray<{ type: string; message: string; sourceAgent: string; severity: string }>,
): PlatformSignal[] {
  if (priorSignals.length === 0 || currentSignals.length === 0) return [];
  const priorFingerprints = new Set(priorSignals.map(signalFingerprint));
  return currentSignals.filter((s) => priorFingerprints.has(signalFingerprint(s)));
}

/**
 * The seven failure types the platform recognises. Wired to
 * `platform_self_healing_config.failure_type` (migration 020).
 */
export type FailureType =
  | 'generate-error'
  | 'gate-max-retries'
  | 'pipeline-failed'
  | 'pipeline-timeout'
  | 'deploy-error'
  | 'maintenance-error'
  | 'custom-agent-failure'
  /**
   * TR_027 / ADR-051 — PR-Agent posted a `CHANGES_REQUESTED`
   * review on the PR. CI itself may have passed; the verdict
   * comes from the AI code reviewer. The PR-Agent comment body
   * is forwarded as `technicalDetail` so the LLM diagnostician
   * can read the actual feedback and pick the right action
   * (`retry` / `fix-intent` / `escalate`) per ADR-050.
   */
  | 'review-requested-changes';

/**
 * The payload the loop needs to drive a retry / escalation. The
 * orchestrator builds this from its own context — same fields the
 * pipeline-feedback resume payload already used.
 */
export interface SelfHealingLoopPayload {
  failureType: FailureType;
  correlationId: string;
  intentId: string;
  projectId: string;
  intentText: string;
  branchName?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  /**
   * Extra fields merged into the escalation alert's `context` JSONB.
   * Used by callers (pipeline-agent, deploy-orchestrator) that need
   * the alert to carry domain-specific data the dashboard renders —
   * e.g. `runId` and `pipelineStatus` for pipeline-failed alerts so
   * the existing PipelineBody component continues to work.
   */
  alertContextExtras?: Record<string, unknown>;
}

export interface SelfHealingResult {
  shouldRetry: boolean;
  diagnosis: SelfHealingDiagnosis | null;
  /**
   * True when the loop created an alert for human attention (budget
   * exhausted, diagnosis declined, or self-healing disabled).
   */
  escalated: boolean;
  /**
   * True when the escalation path's auto-resolver SUCCESSFULLY
   * re-dispatched the intent. When true, the intent is already at
   * `generating` and the caller MUST NOT transition it to `failed`.
   * When false (the common case for escalations — auto-resolve
   * didn't reach high confidence), the caller transitions to
   * `failed` so the alert has a waiting state.
   */
  autoResolved: boolean;
  /**
   * TR_024 — true when the diagnostician picked `action: 'fix-intent'`
   * and the loop successfully dispatched a child fix intent. The
   * parent intent is left in `waiting-for-clarification` (with
   * `lastResumeContext.waitingForFix: true`) and resumes when the
   * fix's production promotion fires `onSuccessDispatch`. The
   * orchestrator MUST NOT transition the parent to `failed` or
   * dispatch a retry — the resume is the fix-intent's responsibility.
   */
  pendingFix?: boolean;
}

/**
 * Fallback used when `platform_self_healing_config` has no row for
 * the failure type (shouldn't happen post-migration-020 — the
 * migration seeds all seven — but a forward-compat third-party
 * caller might add a new failure type before the seed runs).
 */
const DEFAULT_CONFIG: SelfHealingConfigRecord = {
  id: 'default',
  failureType: 'unknown',
  maxAttempts: 2,
  confidenceThreshold: 'medium',
  autoResolveAlerts: true,
  enabled: true,
  updatedBy: null,
  updatedAt: new Date(),
};

/**
 * Entry point. Returns a `SelfHealingResult` the caller branches on.
 * NEVER throws — see invariants above.
 */
export async function runSelfHealingLoop(
  context: SelfHealingContext,
  payload: SelfHealingLoopPayload,
  signals: PlatformSignal[],
): Promise<SelfHealingResult> {
  try {
    return await runSelfHealingLoopUnsafe(context, payload, signals);
  } catch (err) {
    // Outermost safety net. Any unhandled throw from the inner
    // implementation (repository call, event emit, etc.) falls
    // through to escalation — we can't lose track of a failing
    // cycle just because the self-healing path itself broke.
    log.warn(
      { err, correlationId: payload.correlationId, failureType: payload.failureType },
      'runSelfHealingLoop hit unexpected error — escalating',
    );
    try {
      const autoResolved = await escalateToHuman(
        payload,
        context,
        signals,
        `Self-healing loop error: ${(err as Error)?.message ?? String(err)}`,
      );
      return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
    } catch (escalateErr) {
      // If even escalation throws, log and bail. Returning
      // `escalated: false` here lets the caller transition to
      // `failed` so the cycle doesn't hang.
      log.error({ err: escalateErr }, 'Escalation failed during self-healing fallback');
      return { shouldRetry: false, diagnosis: null, escalated: false, autoResolved: false };
    }
  }
}

async function runSelfHealingLoopUnsafe(
  context: SelfHealingContext,
  payload: SelfHealingLoopPayload,
  signals: PlatformSignal[],
): Promise<SelfHealingResult> {
  const repos = getRepositories();

  const config =
    (await repos.selfHealingConfig.findByType(payload.failureType)) ?? DEFAULT_CONFIG;

  if (!config.enabled) {
    const autoResolved = await escalateToHuman(
      payload,
      context,
      signals,
      'Self-healing disabled for this failure type',
    );
    return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
  }

  // Fix C — short-circuit on known-unrecoverable errors before any
  // LLM call. The diagnostician cannot pick a retry path that fixes
  // a missing table, a bad UUID, or a refused connection; calling
  // the LLM only burns latency + tokens.
  const unrecoverableSource =
    (context.technicalDetail && isUnrecoverableError(context.technicalDetail))
      ? context.technicalDetail
      : (context.failureSummary && isUnrecoverableError(context.failureSummary))
        ? context.failureSummary
        : null;
  if (unrecoverableSource) {
    log.info(
      { failureType: payload.failureType, correlationId: payload.correlationId },
      'Unrecoverable error detected — skipping LLM diagnosis, escalating immediately',
    );
    const autoResolved = await escalateToHuman(
      payload,
      context,
      signals,
      `Unrecoverable infrastructure error: ${unrecoverableSource.slice(0, 200)}`,
    );
    return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
  }

  const intent = await repos.intents.findById(payload.intentId);
  // `attemptCount` post-migration-020 starts at 0 for fresh intents.
  // The first call to runSelfHealingLoop is therefore "attempt 1"
  // semantically — we've already attempted the cycle once and it
  // failed.
  const currentAttempt = (intent?.attemptCount ?? 0) + 1;

  if (currentAttempt > config.maxAttempts) {
    const autoResolved = await escalateToHuman(
      payload,
      context,
      signals,
      `Budget exhausted after ${currentAttempt - 1} self-healing attempt(s) (max ${config.maxAttempts})`,
    );
    return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
  }

  // TEST_REPORT_004 Fix 4 — escape hatch on retry-introduced
  // violations. If we're on attempt 2+ AND the current signal set
  // contains rule/message combinations that weren't in the PRIOR
  // attempt's signal set, the previous amendment backfired
  // (introduced new violations the diagnostician can't reason
  // through). Without this guard the diagnostician keeps amending
  // the intent, each amendment trips a different rule, retries
  // pile up, and the cycle ultimately fails with a confused state.
  //
  // Concrete trace from TEST_REPORT_004:
  //   - Round 1 review says "missing audit"
  //   - Diagnostician amends the intent: "…with audit logging…"
  //   - Round 2 code-agent uses `console.log` for the audit
  //   - The `no-console` rule fires
  //   - Round 3 would need to fix BOTH the missing-audit AND
  //     no-console at once — the diagnostician can't.
  //
  // Escalation here is preferable because:
  //   - the loop has already tried at least once
  //   - the new violation is evidence that the diagnostician's
  //     last amendment caused the regression, not the original
  //     intent
  //   - the operator can review + decide whether to back out the
  //     amendment or accept the new findings.
  const priorResume = (intent?.lastResumeContext ?? null) as ResumeContext | null;

  // TEST_REPORT_012 Fix 3 — review-agent hallucination-loop escape
  // hatch. Fires BEFORE the retry-introduced-violations check
  // because the symptoms partially overlap: both manifest as a
  // multi-round cycle the diagnostician can't break out of, but
  // the repeated-signal pattern is the more common one (TR_011
  // burned 8 rounds on it). When >50% of the current attempt's
  // signals fingerprint-match the prior attempt's signals AND we're
  // past attempt 1, the gate is stuck on the same findings round
  // after round — the diagnostician can't reason its way past
  // false-positive review findings, so escalating to a human is
  // the only productive next step.
  if (priorResume?.autoHealed && currentAttempt > 1) {
    const repeatedSignals = detectRepeatedSignalLoop(
      signals,
      priorResume.priorSignals ?? [],
    );
    const repeatRatio = signals.length > 0
      ? repeatedSignals.length / signals.length
      : 0;
    if (
      repeatedSignals.length > 0
      && repeatRatio > REPEATED_SIGNAL_THRESHOLD
    ) {
      log.info(
        {
          correlationId: payload.correlationId,
          attempt: currentAttempt,
          repeatedCount: repeatedSignals.length,
          totalCurrent: signals.length,
          repeatRatio: Math.round(repeatRatio * 100) / 100,
        },
        'Review-agent hallucination loop detected — escalating instead of amending again',
      );
      const summary = repeatedSignals
        .slice(0, 3)
        .map((s) => `${s.type} (${s.sourceAgent}): ${s.message.slice(0, 80)}`)
        .join(' | ');
      const autoResolved = await escalateToHuman(
        payload,
        context,
        signals,
        `Review-agent loop detected: ${repeatedSignals.length} of ${signals.length} ` +
        `findings are identical to the prior attempt (${Math.round(repeatRatio * 100)}% repeat rate) ` +
        `across ${currentAttempt} rounds. Likely hallucination — human review required. Repeated: ${summary}`,
      );
      return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
    }
  }

  if (priorResume?.autoHealed && currentAttempt > 1) {
    const newViolations = detectRetryIntroducedViolations(
      signals,
      priorResume.priorSignals ?? [],
    );
    if (newViolations.length > 0) {
      log.info(
        {
          correlationId: payload.correlationId,
          attempt: currentAttempt,
          newViolations: newViolations.map(
            (s) => `${s.type}:${s.message.slice(0, 60)}`,
          ),
        },
        'Self-healing retry introduced new violations — escalating instead of amending again',
      );
      const summary = newViolations
        .slice(0, 3)
        .map((s) => `${s.type} (${s.sourceAgent}): ${s.message.slice(0, 80)}`)
        .join(' | ');
      const autoResolved = await escalateToHuman(
        payload,
        context,
        signals,
        `Self-healing retry introduced new violations not present in the prior attempt — the last amendment may have overcorrected. New: ${summary}`,
      );
      return { shouldRetry: false, diagnosis: null, escalated: true, autoResolved };
    }
  }

  // Diagnosis. The agent itself never throws; even on parse failure
  // it returns a safe-default `shouldRetry: false, confidence: low`.
  const agent = new SelfHealingAgent();
  const diagnosis = await agent.diagnose(
    context,
    payload.correlationId,
    config.confidenceThreshold,
  );

  // TR_024 (ADR-050) — action routes the loop. The LLM evaluates the
  // failure context and picks 'retry' / 'fix-intent' / 'escalate'.
  // There is NO hardcoded failure-pattern matching here — the action
  // field is the sole routing decision.
  if (diagnosis.action === 'fix-intent' && (diagnosis.fixIntent ?? '').trim() !== '') {
    // TR_025 — cascade-depth brake. A fix-intent shouldn't itself
    // spawn another fix-intent more than once. Without this bound,
    // each CI failure on a fix-intent causes the diagnostician to
    // pick fix-intent again, and the parent_intent_id chain grows
    // indefinitely (TR_024 verification cycle observed a 3-deep
    // runaway). ADR-050 stays intact — the LLM still decides what
    // ACTION to take; the platform only enforces a hard ceiling
    // on chain depth, identical in spirit to MAX_GATE_RETRIES.
    const chainDepth = await getFixIntentChainDepth(payload.intentId, repos);
    if (chainDepth >= MAX_FIX_INTENT_DEPTH) {
      log.warn(
        {
          correlationId: payload.correlationId,
          intentId: payload.intentId,
          chainDepth,
          maxDepth: MAX_FIX_INTENT_DEPTH,
        },
        'Fix-intent chain depth limit reached — escalating instead of cascading',
      );
      const cleanDiagnosis = stripTrailingPunctuation(diagnosis.diagnosis);
      const autoResolved = await escalateToHuman(
        payload,
        context,
        signals,
        `Fix-intent chain exceeded depth ${MAX_FIX_INTENT_DEPTH}. ` +
        `Diagnosis: ${cleanDiagnosis}. Manual intervention required.`,
      );
      return { shouldRetry: false, diagnosis, escalated: true, autoResolved };
    }

    log.info(
      {
        correlationId: payload.correlationId,
        failureType: payload.failureType,
        rationale: (diagnosis.fixIntentRationale ?? '').slice(0, 120),
        fixIntent: diagnosis.fixIntent!.slice(0, 100),
        confidence: diagnosis.confidence,
        chainDepth,
      },
      'Self-healing: systemic gap detected — submitting fix intent',
    );

    try {
      await submitFixIntent({
        fixIntent: diagnosis.fixIntent!,
        fixIntentRationale: diagnosis.fixIntentRationale,
        originalIntentId: payload.intentId,
        projectId: payload.projectId,
        resumeAfterFix: diagnosis.resumeAfterFix ?? true,
      });

      const resumeContextForParent: ResumeContext = {
        operatorFeedback: `[Auto-fix pending] ${diagnosis.fixIntentRationale ?? diagnosis.diagnosis}`,
        failureType: payload.failureType,
        failureSummary: context.failureSummary,
        priorSignals: signals.map((s) => ({
          type: s.type,
          message: s.message,
          sourceAgent: s.sourceAgent,
          severity: s.severity,
        })),
        priorArtifactPaths: context.priorArtifactPaths,
        attemptNumber: currentAttempt,
        feedbackProvidedAt: new Date().toISOString(),
        autoHealed: true,
        diagnosis: diagnosis.diagnosis,
        rootCause: diagnosis.rootCause,
        waitingForFix: true,
      };
      await repos.intents.saveResumeContext(payload.intentId, resumeContextForParent);

      eventBus.emit({
        type: 'intent.status-changed',
        correlationId: payload.correlationId,
        payload: {
          intentId: payload.intentId,
          status: 'waiting-for-clarification',
          reason: 'awaiting-auto-fix',
        },
        timestamp: new Date().toISOString(),
      });
      // Park the parent in waiting-for-clarification so the
      // dashboard shows the "Awaiting auto-fix" panel.
      // Best-effort — a failed transition shouldn't roll back the
      // dispatched fix intent.
      try {
        await repos.intents.updateStatus(payload.intentId, 'waiting-for-clarification');
      } catch (err) {
        log.warn(
          { err, intentId: payload.intentId },
          'Parent intent status transition failed — fix intent already dispatched',
        );
      }

      return {
        shouldRetry: false,
        diagnosis,
        escalated: false,
        autoResolved: false,
        pendingFix: true,
      };
    } catch (err) {
      // Fix-intent dispatch failed (e.g. queue down, repo lookup
      // failed). Fall through to the existing escalation path so the
      // parent doesn't hang.
      log.warn(
        { err, correlationId: payload.correlationId },
        'submitFixIntent failed — escalating',
      );
      const cleanDiagnosis = stripTrailingPunctuation(diagnosis.diagnosis);
      const autoResolved = await escalateToHuman(
        payload,
        context,
        signals,
        `Diagnosis: ${cleanDiagnosis}. Confidence: ${diagnosis.confidence}. ` +
        `fix-intent dispatch failed — falling back to human review.`,
      );
      return { shouldRetry: false, diagnosis, escalated: true, autoResolved };
    }
  }

  if (diagnosis.action === 'escalate') {
    const cleanDiagnosis = stripTrailingPunctuation(diagnosis.diagnosis);
    const autoResolved = await escalateToHuman(
      payload,
      context,
      signals,
      `Diagnosis: ${cleanDiagnosis}. Confidence: ${diagnosis.confidence}. action: escalate`,
    );
    return { shouldRetry: false, diagnosis, escalated: true, autoResolved };
  }

  // action === 'retry' (or legacy diagnosis with no action field).
  // 'none' is the LLM's "I can't fix this" marker — semantically
  // identical to shouldRetry: false. The two checks are equivalent
  // after the LLM's confidence-threshold downgrade, but we honour
  // both independently in case a future prompt change separates
  // them (e.g. shouldRetry: true with retryTaskType: 'none' meaning
  // "I think this is fixable but I don't know which queue").
  if (!diagnosis.shouldRetry || diagnosis.retryTaskType === 'none') {
    // Fix G — strip trailing punctuation from the LLM's diagnosis
    // before joining with "Confidence: …", otherwise the alert's
    // escalation_reason renders with a double period
    // ("…uuid syntax.. Confidence: medium").
    const cleanDiagnosis = stripTrailingPunctuation(diagnosis.diagnosis);
    const autoResolved = await escalateToHuman(
      payload,
      context,
      signals,
      `Diagnosis: ${cleanDiagnosis}. Confidence: ${diagnosis.confidence}. retryTaskType: ${diagnosis.retryTaskType}`,
    );
    return { shouldRetry: false, diagnosis, escalated: true, autoResolved };
  }

  // High-confidence retry: persist the resume context + bump the
  // attempt counter, then dispatch the right queue. The next
  // dispatch leg reads `intent.lastResumeContext` to populate the
  // prompt (autoHealed branch) AND `selfHealingHints` on its
  // payload to adapt its scripted behaviour (deploy agents only).
  // skipAgents is only applied at high confidence — clear at lower.
  const effectiveSkipAgents =
    diagnosis.confidence === 'high' ? diagnosis.skipAgents ?? [] : [];

  const resumeContext: ResumeContext = {
    operatorFeedback: `[Auto] ${diagnosis.suggestedFix}`,
    failureType: payload.failureType,
    failureSummary: context.failureSummary,
    priorSignals: signals.map((s) => ({
      type: s.type,
      message: s.message,
      sourceAgent: s.sourceAgent,
      severity: s.severity,
    })),
    priorArtifactPaths: context.priorArtifactPaths,
    attemptNumber: currentAttempt,
    feedbackProvidedAt: new Date().toISOString(),
    autoHealed: true,
    diagnosis: diagnosis.diagnosis,
    rootCause: diagnosis.rootCause,
    skipAgents: effectiveSkipAgents,
    focusFiles: diagnosis.focusFiles ?? [],
    updatedIntentText: diagnosis.updatedIntentText,
    retryTaskType: diagnosis.retryTaskType,
    retryPayloadHints: diagnosis.retryPayloadHints,
  };

  await repos.intents.saveResumeContext(payload.intentId, resumeContext);
  await repos.intents.incrementAttemptCount(payload.intentId);

  // Dispatch the retry on the queue the diagnostician chose.
  // Same `source: 'self-healing'` regardless of target queue so the
  // dashboard's attempt-history can recognise auto-driven cycles.
  await dispatch(
    buildRetryDispatch(diagnosis.retryTaskType, payload, diagnosis, 'self-healing'),
    getQueueConfig(),
  );
  // Transition the intent back to `generating` so the dashboard's
  // intent feed reflects the retry-in-flight state immediately.
  // Best-effort — a failed transition shouldn't roll back the
  // dispatch we just queued.
  try {
    await repos.intents.updateStatus(payload.intentId, 'generating');
  } catch (err) {
    log.warn({ err, intentId: payload.intentId }, 'Self-healing status transition failed — dispatch already queued');
  }

  log.info(
    {
      correlationId: payload.correlationId,
      failureType: payload.failureType,
      attemptNumber: currentAttempt,
      confidence: diagnosis.confidence,
      retryTaskType: diagnosis.retryTaskType,
      hintKeys: Object.keys(diagnosis.retryPayloadHints),
      skippedAgents: effectiveSkipAgents.length,
      focusFiles: (diagnosis.focusFiles ?? []).length,
    },
    'Self-healing retry dispatched',
  );

  return { shouldRetry: true, diagnosis, escalated: false, autoResolved: false };
}

/**
 * Builds a typed `TaskMessage` for the retry dispatch. The payload
 * shape varies by target queue (only `generate:intent` cares about
 * `text` + `updatedIntentText`; deploy queues care about `branch` +
 * `prNumber`). `selfHealingHints` is forwarded on every payload so
 * target agents can read+apply known hints. `source` flips between
 * 'self-healing' (regular retry) and 'auto-resolved' (alert auto-
 * resolution).
 */
function buildRetryDispatch(
  taskType: SelfHealingRetryTaskType,
  payload: SelfHealingLoopPayload,
  diagnosis: SelfHealingDiagnosis,
  source: 'self-healing' | 'auto-resolved',
): {
  id: string;
  correlationId: string;
  type: 'generate:intent' | 'deploy:pr' | 'deploy:pipeline' | 'deploy:promotion';
  sourceAgent: 'self-healing-agent';
  targetAgent: 'orchestrator';
  priority: 'normal';
  payload: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
} {
  const basePayload: Record<string, unknown> = {
    intentId: payload.intentId,
    projectId: payload.projectId,
    intentText: payload.intentText,
    source,
    selfHealingHints: diagnosis.retryPayloadHints,
    selfHealingDiagnosis: diagnosis.diagnosis,
  };

  let messagePayload: Record<string, unknown>;
  let resolvedType: 'generate:intent' | 'deploy:pr' | 'deploy:pipeline' | 'deploy:promotion';

  if (taskType === 'generate:intent') {
    resolvedType = 'generate:intent';
    messagePayload = {
      ...basePayload,
      text: diagnosis.updatedIntentText ?? payload.intentText,
      resumeOnBranch: payload.branchName ?? undefined,
      prNumber: payload.prNumber ?? undefined,
      prUrl: payload.prUrl ?? undefined,
    };
  } else if (taskType === 'deploy:pr') {
    resolvedType = 'deploy:pr';
    messagePayload = {
      ...basePayload,
      resumeOnBranch: payload.branchName ?? undefined,
      branch: payload.branchName ?? undefined,
      prNumber: payload.prNumber ?? undefined,
      prUrl: payload.prUrl ?? undefined,
      // Empty artifacts — pr-agent's recovery path reads
      // `payload.selfHealingHints.skipArtifactRewrite` AND the
      // existing branch state to decide what to push.
      artifacts: [],
    };
  } else if (taskType === 'deploy:pipeline') {
    resolvedType = 'deploy:pipeline';
    messagePayload = {
      ...basePayload,
      branch: payload.branchName ?? undefined,
      prNumber: payload.prNumber ?? undefined,
      prUrl: payload.prUrl ?? undefined,
    };
  } else {
    // 'deploy:promote' — the platform's queue name is
    // 'deploy:promotion' (matches the existing promotion-agent
    // dispatch). Both names refer to the same thing; this is the
    // only place the LLM-facing alias diverges.
    resolvedType = 'deploy:promotion';
    // Hint: `retryProductionOnly` → dispatch the production
    // promotion directly instead of redoing staging. Read here
    // (NOT inside the agent) because the queue target — staging
    // vs production — is set at dispatch time.
    const retryProductionOnly = Boolean(
      (diagnosis.retryPayloadHints as { retryProductionOnly?: unknown } | undefined)?.retryProductionOnly,
    );
    messagePayload = {
      ...basePayload,
      branch: payload.branchName ?? undefined,
      prNumber: payload.prNumber ?? undefined,
      // Default to staging; the LLM can flip to production-only
      // via the hint when the diagnosis says staging is already
      // good. ADR-034 still enforces "no production without a
      // confirmed staging promotion" in the agent — if there's
      // no staging row, the agent surfaces a GOLDEN_PRINCIPLE_BREACH
      // and the dispatch is rejected regardless of the hint.
      targetEnvironment: retryProductionOnly ? 'production' : 'staging',
    };
  }

  return {
    id: crypto.randomUUID(),
    correlationId: payload.correlationId,
    type: resolvedType,
    sourceAgent: 'self-healing-agent',
    targetAgent: 'orchestrator',
    priority: 'normal',
    payload: messagePayload,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

/**
 * Maps the failure type to its alert type. Today the two unions
 * align 1:1 (every failure type has a matching `AlertType` entry).
 */
function failureTypeToAlertType(failureType: FailureType): AlertType {
  return failureType as AlertType;
}

/**
 * Creates the failure alert. Called whenever the self-healing loop
 * exits without a retry — either disabled, budget exhausted, or
 * diagnosis said `shouldRetry: false`. Then optionally invokes the
 * auto-resolver (`attemptAutoResolveAlert`) when the config flag
 * is set.
 *
 * Failure non-fatal: a failed `alerts.create` writes a warn log and
 * the loop returns `escalated: true` regardless — the operator can
 * still see the intent reach `failed` from the orchestrator's
 * caller-side transition.
 */
/**
 * Returns true when the auto-resolve path successfully re-dispatched
 * the intent (caller MUST NOT transition to `failed` — it's already
 * at `generating`). Returns false otherwise.
 */
async function escalateToHuman(
  payload: SelfHealingLoopPayload,
  context: SelfHealingContext,
  signals: PlatformSignal[],
  reason: string,
): Promise<boolean> {
  const repos = getRepositories();
  const config =
    (await repos.selfHealingConfig.findByType(payload.failureType)) ?? DEFAULT_CONFIG;

  let alertId: string | null = null;
  try {
    const alert = await repos.alerts.create({
      correlationId: payload.correlationId,
      intentId: payload.intentId,
      type: failureTypeToAlertType(payload.failureType),
      severity: 'high',
      title: buildAlertTitle(payload, context),
      description: `${context.failureSummary}\n\nEscalation reason: ${reason}`,
      requiredAction: 'provide-feedback' as AlertRequiredAction,
      context: {
        intentId: payload.intentId,
        branch: payload.branchName ?? null,
        prNumber: payload.prNumber ?? null,
        prUrl: payload.prUrl ?? null,
        failureType: payload.failureType,
        attemptNumber: context.attemptNumber,
        escalationReason: reason,
        ...(payload.alertContextExtras ?? {}),
      },
    });
    alertId = alert.id;

    eventBus.emit({
      type: 'alert.created',
      correlationId: payload.correlationId,
      payload: { alertId: alert.id, type: alert.type },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.warn(
      { err, correlationId: payload.correlationId },
      'Failed to create escalation alert — continuing',
    );
  }

  if (config.autoResolveAlerts && alertId) {
    // Non-blocking attempt to auto-resolve. If it succeeds the
    // intent is back to `generating`; if not the alert stays open
    // for human input.
    return await attemptAutoResolveAlert(alertId, payload, context, signals);
  }
  return false;
}

const TITLE_TEMPLATES: Record<FailureType, string> = {
  'generate-error':            'Generate failure',
  'gate-max-retries':          'Quality gate exhausted retries',
  'pipeline-failed':           'CI pipeline failed',
  'pipeline-timeout':          'CI pipeline timed out',
  'deploy-error':              'Deploy failure',
  'maintenance-error':         'Maintenance run failure',
  'custom-agent-failure':      'Custom agent failure',
  'review-requested-changes':  'PR-Agent requested changes',
};

function buildAlertTitle(
  payload: SelfHealingLoopPayload,
  context: SelfHealingContext,
): string {
  const intentLine = payload.intentText.split('\n')[0].slice(0, 60);
  const prefix = TITLE_TEMPLATES[payload.failureType] ?? payload.failureType;
  return `${prefix} for intent '${intentLine}' (attempt ${context.attemptNumber})`;
}

/**
 * Re-invokes the diagnostician at HIGH confidence against the same
 * context — the brief's "automated alert resolver". If the agent
 * returns a high-confidence shouldRetry, we ack the alert and
 * dispatch a fresh generate cycle with `source: 'auto-resolved'`.
 *
 * NEVER throws — alert stays open if auto-resolve can't make
 * progress, non-fatal for the caller.
 */
/**
 * Returns true when the auto-resolver successfully dispatched a fresh
 * cycle (and acknowledged the alert). Returns false when confidence
 * was too low OR the LLM call failed.
 */
async function attemptAutoResolveAlert(
  alertId: string,
  payload: SelfHealingLoopPayload,
  context: SelfHealingContext,
  signals: PlatformSignal[],
): Promise<boolean> {
  const repos = getRepositories();
  try {
    const agent = new SelfHealingAgent();
    const diagnosis = await agent.diagnose(
      {
        ...context,
        failureSummary: `${context.failureSummary} [Alert auto-resolve attempt]`,
      },
      payload.correlationId,
      'high', // Higher bar than the per-config threshold for auto-resolution.
    );

    if (!diagnosis.shouldRetry || diagnosis.confidence !== 'high') {
      log.info(
        {
          alertId,
          correlationId: payload.correlationId,
          confidence: diagnosis.confidence,
        },
        'Auto-resolve did not reach high confidence — alert remains open',
      );
      return false;
    }

    // Treat 'none' as no-retry — auto-resolve only fires when the
    // LLM picks a concrete target queue.
    if (diagnosis.retryTaskType === 'none') {
      log.info(
        { alertId, correlationId: payload.correlationId },
        'Auto-resolve diagnosis returned retryTaskType=none — alert remains open',
      );
      return false;
    }

    const resumeContext: ResumeContext = {
      operatorFeedback: `[Auto-resolved] ${diagnosis.suggestedFix}`,
      failureType: payload.failureType,
      failureSummary: context.failureSummary,
      priorSignals: signals.map((s) => ({
        type: s.type,
        message: s.message,
        sourceAgent: s.sourceAgent,
        severity: s.severity,
      })),
      priorArtifactPaths: context.priorArtifactPaths,
      attemptNumber: context.attemptNumber + 1,
      feedbackProvidedAt: new Date().toISOString(),
      autoHealed: true,
      diagnosis: diagnosis.diagnosis,
      rootCause: diagnosis.rootCause,
      skipAgents: diagnosis.skipAgents ?? [],
      focusFiles: diagnosis.focusFiles ?? [],
      updatedIntentText: diagnosis.updatedIntentText,
      retryTaskType: diagnosis.retryTaskType,
      retryPayloadHints: diagnosis.retryPayloadHints,
    };

    await repos.intents.saveResumeContext(payload.intentId, resumeContext);
    await repos.intents.incrementAttemptCount(payload.intentId);
    // Acknowledged by the platform — actor 'system'. Audit captured
    // implicitly via the alert row's acknowledgedBy column.
    await repos.alerts.acknowledge(alertId, 'system');
    await repos.intents.updateStatus(payload.intentId, 'generating');

    await dispatch(
      buildRetryDispatch(diagnosis.retryTaskType, payload, diagnosis, 'auto-resolved'),
      getQueueConfig(),
    );

    eventBus.emit({
      type: 'alert.auto-resolved',
      correlationId: payload.correlationId,
      payload: {
        alertId,
        diagnosis: diagnosis.diagnosis,
        rootCause: diagnosis.rootCause,
      },
      timestamp: new Date().toISOString(),
    });

    log.info(
      { alertId, correlationId: payload.correlationId },
      'Alert auto-resolved — intent re-dispatched',
    );
    return true;
  } catch (err) {
    // Non-fatal — alert stays open for human attention.
    log.warn(
      { err, alertId, correlationId: payload.correlationId },
      'Auto-resolve attempt failed — alert remains open',
    );
    return false;
  }
}

/**
 * TR_024 — submit a self-healing fix intent as a separate generate
 * cycle. Called when the diagnostician picked `action: 'fix-intent'`.
 *
 * Two-step process per migration 026:
 *   1. INSERT the new intent row with `source: 'self-healing-fix'`,
 *      priority high, and `parent_intent_id` pointing at the
 *      original intent.
 *   2. When `resumeAfterFix` is true, persist the resume-dispatch
 *      envelope on the FIX intent (NOT the parent). The promotion-
 *      agent reads this column after the fix's production promotion
 *      and dispatches the envelope verbatim — typically a
 *      `generate:intent` with `source: 'self-healing-resume'` against
 *      the original intent id.
 *   3. Dispatch `generate:intent` for the fix on the generate queue
 *      so the standard SDLC chain (generate → gate → deploy →
 *      promotion) carries it through.
 *
 * Throws on infrastructure failure (DB / queue) — the loop catches
 * and falls back to human escalation so the parent doesn't hang.
 */
async function submitFixIntent(params: {
  fixIntent: string;
  fixIntentRationale?: string;
  originalIntentId: string;
  projectId: string;
  resumeAfterFix: boolean;
}): Promise<void> {
  const repos = getRepositories();
  const fixIntentId = crypto.randomUUID();
  const fixCorrelationId = crypto.randomUUID();

  const fixIntent = await repos.intents.create({
    id: fixIntentId,
    correlationId: fixCorrelationId,
    projectId: params.projectId,
    text: params.fixIntent,
    status: 'pending',
    source: 'self-healing-fix',
    priority: 'high',
    parentIntentId: params.originalIntentId,
  });

  if (params.resumeAfterFix) {
    // Envelope shape mirrors the existing `generate:intent` BullMQ
    // payload. The promotion-agent dispatches it verbatim — unknown
    // keys are silently ignored by downstream handlers, so future
    // additions are forward-compat.
    const resumeEnvelope: Record<string, unknown> = {
      type: 'generate:intent',
      payload: {
        intentId: params.originalIntentId,
        projectId: params.projectId,
        source: 'self-healing-resume',
        fixIntentId,
      },
    };
    await repos.intents.saveOnSuccessDispatch(fixIntentId, resumeEnvelope);
  }

  await repos.intents.updateStatus(fixIntentId, 'generating');
  eventBus.emit({
    type: 'intent.created',
    correlationId: fixCorrelationId,
    payload: {
      intentId: fixIntentId,
      text: params.fixIntent.slice(0, 200),
      priority: 'high',
      source: 'self-healing-fix',
      parentIntentId: params.originalIntentId,
    },
    timestamp: new Date().toISOString(),
  });

  await dispatch(
    {
      id: crypto.randomUUID(),
      correlationId: fixCorrelationId,
      type: 'generate:intent',
      sourceAgent: 'self-healing-agent',
      targetAgent: 'orchestrator',
      priority: 'high',
      payload: {
        intentId: fixIntentId,
        projectId: params.projectId,
        text: params.fixIntent,
        source: 'self-healing-fix',
        parentIntentId: params.originalIntentId,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    getQueueConfig(),
  );

  log.info(
    {
      fixIntentId,
      originalIntentId: params.originalIntentId,
      resumeAfterFix: params.resumeAfterFix,
      rationalePrefix: (params.fixIntentRationale ?? '').slice(0, 80),
    },
    'Fix intent dispatched — original will resume on success',
  );
  void fixIntent;
}

/**
 * Re-export used by orchestrator-side code that needs to widen its
 * own failure-source union to include the self-healing variants.
 */
export type ResumeSource =
  | 'human'
  | 'maintenance-agent'
  | 'pipeline-feedback'
  | 'self-healing'
  | 'auto-resolved'
  | 'operator-resume'
  | 'self-healing-fix'
  | 'self-healing-resume';

/**
 * Skip-agent helper for orchestrators. Returns true when the
 * agent role appears in the intent's `lastResumeContext.skipAgents`
 * list AND the resume was auto-healed at high confidence.
 * Centralised here so the policy ("only honour skipAgents on
 * auto-healed high-confidence retries") lives in one place.
 *
 * Note: the loop already clears `skipAgents` for lower-confidence
 * diagnoses before writing them — this helper is the second
 * defence at the consume site.
 */
export function shouldSkipAgent(
  resumeContext: ResumeContext | null | undefined,
  agentRole: AgentRole,
): boolean {
  if (!resumeContext) return false;
  if (!resumeContext.autoHealed) return false;
  return (resumeContext.skipAgents ?? []).includes(agentRole);
}
