/**
 * Shared selfHealingNode (TR_056 / ADR-056 Phase 4+5).
 *
 * **Why shared, not per-layer:** TR_055b §6 explicitly named
 * divergence across layer-specific self-healing nodes as a regression
 * risk. This node lives under quality-gate today because gate is the
 * first layer migrated; later layers (generate, deploy) import the
 * SAME function. When the generate session lands, this file moves up
 * to a layer-neutral package (`@gestalt/core/graphs/shared/`) but the
 * implementation stays singular.
 *
 * **B-i/B-ii decision: B-i.** TR_054 restart-resume verification is
 * `in_progress` and not yet proven. Per the TR_056 prerequisite,
 * Path B (fix-intent) uses the existing TR_024 mechanism — child
 * intent inserted with `parent_intent_id`, `onSuccessDispatch`
 * envelope minted on the child, BullMQ `generate:intent` dispatched,
 * parent parked at `waiting-for-clarification`. The parent's resume
 * is the existing onSuccessDispatch fire — NOT a LangGraph
 * `interrupt()` + `Command({resume})`. When TR_054 B4 proves
 * restart-resume, this node converts to Path B-ii (parent
 * `interrupt()`s; event-bus subscriber resumes via `Command`).
 *
 *   // TR_054-PENDING: revisit B-ii once restart-resume verified
 *
 * **Edge guards in TR_055b §5 order:**
 *
 *   1. UNRECOVERABLE_ERROR_PATTERNS short-circuit (lives inside
 *      `runSelfHealingLoopUnsafe` — runs FIRST before diagnose).
 *   2. Hallucination-loop brake (REPEATED_SIGNAL_THRESHOLD) +
 *      retry-introduced-violations check (lives in
 *      `runSelfHealingLoopUnsafe:436-502`).
 *   3. **ABSOLUTE_MAX_RETRIES = 5 DB cross-check (TR_020 safety
 *      net)** — this node enforces it BEFORE calling the loop.
 *      The check reads `agent_executions`-derived `attemptCount`
 *      from the intents row, NOT graph-local state. A checkpoint
 *      restore that reset `state.retryCount` to 0 cannot unbound
 *      the loop because the DB read is independent.
 *   4. Cascade-depth brake (MAX_FIX_INTENT_DEPTH = 2) — lives
 *      inside the loop at line 526-546, called via
 *      `getFixIntentChainDepth` walker that reads
 *      `parent_intent_id` from the DB (NOT graph-local state).
 *
 * **Alert creation rule (TR_053 Fix 6):** alerts are created by the
 * loop's `escalateToHuman` helper — never by an `interrupt()` node.
 * Since this node DOES NOT interrupt (B-i), the rule is structurally
 * preserved: any alert was created by the canonical
 * escalateToHuman path before the loop returned.
 *
 * **Path C (auto-resolve):** lives inside `attemptAutoResolveAlert`
 * called from `escalateToHuman`. When auto-resolve dispatches a
 * fresh cycle, the loop returns `escalated: true, autoResolved: true`
 * — this node reads that and emits `outcome: 'autoResolved'`.
 *
 * **Retry-target stubs:** when the loop's diagnostician picks
 * `retryTaskType: 'generate:intent'`, the loop dispatches BullMQ
 * `generate:intent` directly (TR_056 transition window — the
 * "wire what exists, TODO for generate session" rule). When the
 * GenerateGraph lands, this node's retry branch becomes a
 * `Command({goto: 'intent-node'})` inside a unified parent graph.
 */

import { Command } from '@langchain/langgraph';
import {
  runSelfHealingLoop,
  getRepositories,
  createContextLogger,
  emitLiveEvent,
} from '@gestalt/core';
import type {
  FailureType, SelfHealingLoopPayload, SelfHealingResult,
  FeedbackSignal, PlatformSignal,
} from '@gestalt/core';
import type { GateGraphStateType, SelfHealingOutcome } from '../gate/state';
import type { SelfHealingContext } from '@gestalt/core';

const log = createContextLogger({ module: 'self-healing-node' });

/**
 * TR_020 absolute safety net (TR_055b §5 — must survive). The
 * loop's `runSelfHealingLoopUnsafe` already enforces a per-failure-
 * type `maxAttempts` budget but that budget is configurable; this
 * is the unconditional ceiling.
 */
const ABSOLUTE_MAX_RETRIES = 5;

export interface SelfHealingNodeInput {
  /**
   * The state slice the layer subgraph passes in. Generic shape so
   * generate / deploy can reuse this without depending on gate's
   * state schema directly.
   */
  intentId: string;
  correlationId: string;
  projectId: string | null;
  intentText: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  failureType: FailureType;
  failureSummary: string;
  technicalDetail?: string;
  signals: FeedbackSignal[];
  /**
   * Layer-specific extras merged into the alert's `context` JSONB.
   * Today only the pipeline-failed alert uses this (runId,
   * pipelineStatus) — gate-max-retries doesn't add anything.
   */
  alertContextExtras?: Record<string, unknown>;
}

export interface SelfHealingNodeResult {
  outcome: SelfHealingOutcome;
  errors: string[];
}

/**
 * Convert FeedbackSignal[] → PlatformSignal[] for the loop. The
 * shapes differ in field names; the loop normalises internally so
 * we just need the convertible subset.
 */
function toPlatformSignals(signals: FeedbackSignal[]): PlatformSignal[] {
  return signals.map((s) => ({
    // FeedbackSignal already extends PlatformSignal's surface but
    // TypeScript's structural check wants the explicit cast.
    id: s.id,
    correlationId: s.correlationId,
    type: s.type,
    severity: s.severity,
    sourceAgent: (s as { agentRole?: string; sourceAgent?: string }).sourceAgent
      ?? (s as { agentRole?: string }).agentRole
      ?? 'review-agent',
    message: s.message,
    location: s.location,
    autoResolvable: s.autoResolvable,
    createdAt: s.createdAt,
  } as PlatformSignal));
}

/**
 * Run the self-healing loop and translate its result into a graph
 * outcome. Returns a `Command({update})` carrying the outcome so
 * the calling layer subgraph can branch on it via conditional
 * edges.
 *
 * Critically: this node DOES NOT itself dispatch BullMQ messages
 * (the loop does, transiently per the TR_056 transition window),
 * and DOES NOT itself create alerts (the loop does via
 * escalateToHuman). The node is pure routing translation.
 */
export async function runSelfHealingNode(
  input: SelfHealingNodeInput,
): Promise<SelfHealingNodeResult> {
  const { intentId, correlationId } = input;
  const errors: string[] = [];

  // ─── Edge guard 3: ABSOLUTE_MAX_RETRIES DB cross-check ───────────
  //
  // TR_020 + TR_055b §5. The per-payload retry counter (graph
  // state) can be reset by a checkpoint restore — the persisted
  // `attemptCount` on the intent row cannot. If the DB says we've
  // already burned 5 attempts on this intent, force-escalate
  // before burning another LLM call on diagnose().
  try {
    const intentRow = await getRepositories().intents.findById(intentId);
    const persistedAttempts = intentRow?.attemptCount ?? 0;
    if (persistedAttempts >= ABSOLUTE_MAX_RETRIES) {
      log.warn(
        {
          correlationId,
          intentId,
          persistedAttempts,
          max: ABSOLUTE_MAX_RETRIES,
        },
        'TR_020 absolute retry limit reached — skipping diagnose, force-escalating',
      );
      // Still create an alert so the operator sees this. We use the
      // alerts repository directly (mirroring the legacy
      // `createBreachAlert` shape) because we don't have access to
      // the loop's escalateToHuman from outside the loop.
      try {
        const alert = await getRepositories().alerts.create({
          correlationId,
          intentId,
          type: input.failureType as
            | 'gate-max-retries'
            | 'generate-error'
            | 'pipeline-failed'
            | 'pipeline-timeout'
            | 'deploy-error'
            | 'maintenance-error'
            | 'custom-agent-failure'
            | 'review-requested-changes',
          severity: 'high',
          title: `${input.failureType} — absolute retry limit (${ABSOLUTE_MAX_RETRIES}) reached`,
          description:
            `${input.failureSummary}\n\n` +
            `Persisted attempt count: ${persistedAttempts}. ` +
            `TR_020 ABSOLUTE_MAX_RETRIES safety net triggered. ` +
            `Manual intervention required.`,
          requiredAction: 'provide-feedback',
          context: {
            intentId,
            persistedAttempts,
            triggeredBy: 'self-healing-node-absolute-cap',
            ...(input.alertContextExtras ?? {}),
          },
        });
        emitLiveEvent('alert.created', correlationId, {
          alertId: alert.id,
          type: alert.type,
          intentId,
          severity: 'high',
        });
      } catch (err) {
        log.warn(
          { err, correlationId, intentId },
          'ABSOLUTE_MAX_RETRIES alert create failed — escalating without alert',
        );
        errors.push(
          `absolute-cap-alert-create: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return { outcome: 'escalated', errors };
    }
  } catch (err) {
    log.warn(
      { err, correlationId, intentId },
      'TR_020 attemptCount lookup failed — proceeding to loop',
    );
    // Fall through. The loop's own budget check is the secondary
    // defence; we don't want a transient DB error to skip
    // self-healing entirely.
  }

  // ─── Build the loop context ──────────────────────────────────────
  //
  // The loop's `runSelfHealingLoopUnsafe` enforces guards 1, 2, 4
  // (UNRECOVERABLE + hallucination-loop + cascade-depth) in this
  // order before calling agent.diagnose(). The loop ALSO handles
  // retry dispatch (BullMQ — transition window), fix-intent
  // dispatch (B-i path: insert child + onSuccessDispatch + park
  // parent), and escalation (alert + auto-resolve attempt).
  //
  // Resolve the intent row freshly (the absolute-cap path above
  // may have read it but we want a defensive re-read in case the
  // path was skipped due to a transient error).
  let intentRow: Awaited<
    ReturnType<ReturnType<typeof getRepositories>['intents']['findById']>
  > = null;
  try {
    intentRow = await getRepositories().intents.findById(intentId);
  } catch (err) {
    log.error(
      { err, intentId, correlationId },
      'selfHealingNode: intent lookup threw — cannot run loop',
    );
    errors.push(
      `intent-lookup: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { outcome: 'noop', errors };
  }
  if (!intentRow) {
    log.warn({ intentId, correlationId }, 'selfHealingNode: intent not found');
    return { outcome: 'noop', errors };
  }

  const platformSignals = toPlatformSignals(input.signals);

  let priorArtifactPaths: string[] = [];
  try {
    const artifacts = await getRepositories().artifacts.findByCorrelationId(
      correlationId,
    );
    priorArtifactPaths = artifacts.map((a) => a.path);
  } catch (err) {
    log.warn(
      { err, correlationId },
      'selfHealingNode: artifact lookup failed — using empty list',
    );
  }

  const context: SelfHealingContext = {
    intentText: input.intentText ?? intentRow.text,
    failureType: input.failureType,
    failureSummary: input.failureSummary,
    technicalDetail: input.technicalDetail,
    attemptNumber: (intentRow.attemptCount ?? 0) + 1,
    priorSignals: platformSignals.map((s) => ({
      type: s.type,
      message: s.message,
      sourceAgent: s.sourceAgent,
      severity: s.severity,
    })),
    priorArtifactPaths,
  };

  const payload: SelfHealingLoopPayload = {
    failureType: input.failureType,
    correlationId,
    intentId,
    projectId: input.projectId ?? intentRow.projectId,
    intentText: input.intentText ?? intentRow.text,
    branchName: input.branch ?? intentRow.branchName,
    prNumber: input.prNumber ?? intentRow.prNumber,
    prUrl: input.prUrl ?? intentRow.prUrl,
    ...(input.alertContextExtras
      ? { alertContextExtras: input.alertContextExtras }
      : {}),
  };

  // ─── Run the canonical loop ──────────────────────────────────────
  //
  // The loop NEVER throws (its own outermost safety net). It
  // returns a SelfHealingResult; we translate.
  let result: SelfHealingResult;
  try {
    result = await runSelfHealingLoop(context, payload, platformSignals);
  } catch (err) {
    // Defensive — the loop is supposed to be NEVER-throws but if
    // its safety net itself breaks, we still want a deterministic
    // node outcome.
    log.error(
      { err, intentId, correlationId },
      'selfHealingNode: loop unexpectedly threw — treating as escalated',
    );
    errors.push(
      `loop-throw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { outcome: 'escalated', errors };
  }

  // ─── Translate result to graph outcome ───────────────────────────
  //
  // Branch order: pendingFix > retried > autoResolved > escalated.
  // pendingFix takes precedence because the loop sets shouldRetry
  // false for that branch but the parent is parked at
  // waiting-for-clarification — graph must NOT escalate.
  let outcome: SelfHealingOutcome;
  if (result.pendingFix) {
    outcome = 'pendingFix';
    log.info(
      { intentId, correlationId },
      'selfHealingNode: fix-intent dispatched (B-i path — parent parked at waiting-for-clarification; resume via onSuccessDispatch)',
    );
    // TR_054-PENDING: revisit B-ii once restart-resume verified.
    // Under B-ii, this branch would instead call
    // `interrupt({type: 'await-fix', fixIntentId})` and a separate
    // event-bus subscriber would resume the parent thread.
  } else if (result.shouldRetry && result.diagnosis) {
    outcome = 'retried';
    log.info(
      {
        intentId,
        correlationId,
        retryTaskType: result.diagnosis.retryTaskType,
        confidence: result.diagnosis.confidence,
      },
      'selfHealingNode: retry dispatched (BullMQ transition transport)',
    );
    // TR_056 transition window: the loop dispatched BullMQ
    // (generate:intent / deploy:pr / deploy:pipeline / deploy:promote).
    // When the GenerateGraph + DeployGraph land, this branch
    // becomes a `Command({goto: '<targetNode>'})` inside a unified
    // parent graph and the BullMQ dispatch is deleted.
  } else if (result.escalated && result.autoResolved) {
    outcome = 'autoResolved';
    log.info(
      { intentId, correlationId },
      'selfHealingNode: alert auto-resolved — fresh cycle dispatched',
    );
  } else if (result.escalated) {
    outcome = 'escalated';
    log.info(
      { intentId, correlationId },
      'selfHealingNode: escalated to human — alert created by loop',
    );
  } else {
    // shouldRetry=false, escalated=false — the loop fell through
    // without taking any action. Rare; treat as noop so caller can
    // transition to failed.
    outcome = 'noop';
    log.warn(
      { intentId, correlationId },
      'selfHealingNode: loop returned no-action (neither retry, fix, nor escalate)',
    );
  }

  return { outcome, errors };
}

/**
 * LangGraph node wrapper. Reads the necessary fields from
 * `GateGraphStateType` (or a generic compatible shape) and returns
 * a `Command({update})` carrying the outcome. Conditional edges in
 * the calling graph route on `state.selfHealingOutcome`.
 *
 * The wrapper exists separately from `runSelfHealingNode` so unit
 * tests can call the latter directly with a synthetic input.
 */
export async function selfHealingGateNode(
  state: GateGraphStateType,
): Promise<Command> {
  const verdict = state.gateVerdict;
  const technicalDetail = verdict?.summary?.slice(0, 500);

  const result = await runSelfHealingNode({
    intentId: state.intentId,
    correlationId: state.correlationId,
    projectId: state.projectId,
    intentText: state.intentText,
    branch: state.branch,
    prNumber: state.prNumber,
    prUrl: state.prUrl,
    failureType: 'gate-max-retries',
    failureSummary:
      verdict
        ? `Quality gate ${verdict.verdict} — ${verdict.signalCount} signal(s)`
        : 'Quality gate failure with no verdict',
    ...(technicalDetail ? { technicalDetail } : {}),
    signals: state.priorSignals,
  });

  return new Command({
    update: {
      selfHealingOutcome: result.outcome,
      errors: result.errors,
    },
  });
}
