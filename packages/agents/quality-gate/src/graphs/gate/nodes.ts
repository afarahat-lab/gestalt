/**
 * GateGraph nodes (TR_056 Part 2a / ADR-056 Phase 4).
 *
 * `gateNode` is the verdict-producing node. It lifts the existing
 * `handleGateTask` setup-and-run sequence (gate-orchestrator.ts:
 * 397→675) verbatim:
 *
 *   1. Resolve project (gitUrl + PAT) for the intent.
 *   2. Clone repo into a temp dir; optionally checkout PR branch.
 *   3. Resolve intent text from state or DB.
 *   4. Load HARNESS stack + build GateHarnessConfig.
 *   5. Resolve ArtifactRef[] — from cloned working tree
 *      (ADR-041 post-CI mode) or from the carried payload (legacy
 *      pre-CI mode).
 *   6. Build projectStructureBrief (TR_036).
 *   7. Decide review-agent skip (ADR-051 / TR_027 — PR-Agent already
 *      reviewed; only constraint-agent runs).
 *   8. Run constraint-agent + review-agent in parallel via
 *      `runWithObservability` (Promise.all preserved verbatim).
 *   9. Synthesise GateResult.
 *  10. TR_053 NRB-1 — when verdict is `pass` but one of the agents
 *      threw, patch the errored row to `completed-with-warning`.
 *  11. Emit `gate.completed` SSE event.
 *  12. On verdict === 'escalate': create the GP_BREACH alert HERE
 *      (TR_053 Fix-6 rule — alert creation lives in the deciding
 *      node, never in an interrupt node).
 *  13. Transition intent: pass → 'approved'; escalate → 'escalated';
 *      fail → no-op (selfHealingNode owns the failed/retry split).
 *  14. Clean up the temp workDir.
 *
 * What's intentionally NOT here (deferred to TR_056 Part 2b):
 *
 *   - Conditional edges from gateNode (the graph.ts file wires
 *     pass → END(success), fail|escalate → selfHealingNode).
 *   - The pass-path promotion / deploy:pr dispatch — those become
 *     graph edges to the future DeployGraph; for the 2a session they
 *     are NOT invoked and the pass branch terminates with the intent
 *     at `approved`. The legacy `handleGateTask` remains untouched
 *     so trackeros continues to dispatch promotion through the
 *     existing path.
 *   - Deletion of `dispatchPromotion` / `dispatchDeployPR` /
 *     `maybeDispatchRetry` / `attemptSelfHealingForGate` /
 *     `createBreachAlert` — those land in the 2c session after the
 *     graph wiring is verified.
 *
 * On any thrown error during the node body, the workDir is still
 * cleaned in `finally`, an error string is accumulated into
 * `state.errors`, and a synthetic `gateVerdict: 'fail'` is emitted
 * so the eventual conditional edge routes to `selfHealingNode`.
 * The node does NOT re-throw (LangGraph treats thrown nodes as
 * unrecoverable graph errors).
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  getRepositories, createContextLogger, emitLiveEvent,
  dispatch, getQueueConfig,
} from '@gestalt/core';
import type {
  Artifact, FeedbackSignal,
  AlertType, AlertRequiredAction,
  TaskPriority,
} from '@gestalt/core';

import {
  authenticatedGitUrl,
  resolveProjectFor,
  transitionIntent,
  defaultGateHarnessConfig,
  loadHarnessStack,
  readSourceFilesFromWorkDir,
  buildProjectStructureBrief,
  shouldSkipReviewAgent,
  runWithObservability,
  gateSignalToPlatformSignal,
} from '../../orchestrator/gate-orchestrator';

import { runConstraintAgent, getConstraintAgentInstance } from '../../agents/constraint-agent';
import { ReviewAgent } from '../../agents/llm-review-agent';
import { synthesiseGateResult, summariseGateResult } from '../../agents/review-agent';

import type {
  GateAgentResult, GateHarnessConfig, GateSignal, GateTask, ArtifactRef,
} from '../../types';
import type {
  GateGraphStateType, GateVerdictSummary,
} from './state';

const log = createContextLogger({ module: 'gate-graph-node' });

/**
 * Build a deterministic synthetic verdict the conditional edges can
 * route on when the gateNode body itself failed (clone error, agents
 * threw, etc.). Routes to selfHealingNode the same way a normal
 * `fail` verdict does.
 */
function syntheticFailureVerdict(reason: string, durationMs: number): GateVerdictSummary {
  return {
    verdict: 'fail',
    signalCount: 0,
    signalsJson: '[]',
    summary: `gateNode infrastructure failure: ${reason}`,
    durationMs,
  };
}

/**
 * TR_056 Part 2c — pass-path dispatch from inside the graph.
 *
 * Lifts the verdict-tail dispatch from
 * `gate-orchestrator.handleGateTask:702→722` (the
 * `dispatchPromotion` / `dispatchDeployPR` call sites) into a single
 * leaf action invoked from `gateNode`'s pass branch.
 *
 * Architectural note (per brief §2): this is BullMQ dispatch from
 * inside the graph and it is a LEAF action — the graph emits the
 * deploy task and then `gateNode` returns; the conditional edge
 * routes to END. The gate graph never awaits the deploy lifecycle.
 * Deploy continues to be its own pipeline (today via BullMQ; later
 * via DeployGraph when the deploy session lands).
 *
 * Branch condition mirrors the legacy handler exactly:
 *
 *   readFromBranch === true   → deploy:promotion (ADR-041 post-CI)
 *   readFromBranch === false  → deploy:pr        (legacy pre-CI)
 *
 * Failure modes match the legacy helpers verbatim:
 *
 *   - missing projectId → warn + skip (intent stays approved; operator
 *     re-runs).
 *   - legacy path: missing intentText or empty artifacts → warn + skip.
 *
 * The dispatch itself returns the BullMQ job id; we drop it (the
 * deploy-orchestrator owns the lifecycle from there).
 */
async function dispatchPostGateFromGraph(args: {
  state: GateGraphStateType;
  intentText: string | undefined;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<void> {
  const { state, intentText, childLog } = args;
  const correlationId = state.correlationId;

  // Resolve projectId — preferred from state, fallback to a DB read
  // (mirrors `dispatchPromotion` and `dispatchDeployPR` in the legacy
  // helper).
  let projectId: string | null = state.projectId;
  if (!projectId) {
    const row = await getRepositories().intents.findById(state.intentId);
    projectId = row?.projectId ?? null;
  }

  // Resolve intent text — preferred from arg (gateNode already
  // resolved it once), fallback to a DB read.
  let textForDispatch: string | undefined = intentText;
  if (!textForDispatch) {
    const row = await getRepositories().intents.findById(state.intentId);
    textForDispatch = row?.text ?? undefined;
  }

  const priority: TaskPriority = 'normal';
  const queueConfig = getQueueConfig();

  if (state.readFromBranch) {
    // ADR-041 post-CI path → promotion (staging first; promotion-agent
    // dispatches the production leg itself).
    if (!projectId) {
      childLog.warn(
        { intentId: state.intentId },
        'gateNode pass (post-CI) — cannot resolve projectId; skipping deploy:promotion',
      );
      return;
    }

    await dispatch({
      id: crypto.randomUUID(),
      correlationId,
      type: 'deploy:promotion',
      sourceAgent: 'review-agent',
      targetAgent: 'promotion-agent',
      priority,
      payload: {
        intentId: state.intentId,
        projectId,
        targetEnvironment: 'staging',
        prNumber: state.prNumber ?? undefined,
        branch: state.branch ?? undefined,
        intentText: textForDispatch,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    }, queueConfig);

    childLog.info(
      {
        intentId: state.intentId,
        prNumber: state.prNumber ?? null,
        branch: state.branch ?? null,
        dispatchedBy: 'gate-graph',
      },
      'gateNode pass (post-CI) — dispatched deploy:promotion (staging) via graph',
    );
    return;
  }

  // Legacy pre-CI artifact-based path → deploy:pr so pr-agent can open
  // the PR.
  if (!projectId || !textForDispatch) {
    childLog.warn(
      { intentId: state.intentId },
      'gateNode pass (legacy pre-CI) — cannot reconstruct deploy payload; skipping deploy:pr',
    );
    return;
  }
  if (!state.artifacts || state.artifacts.length === 0) {
    childLog.info(
      { intentId: state.intentId },
      'gateNode pass (legacy pre-CI) — no artifacts in state; skipping deploy:pr',
    );
    return;
  }

  await dispatch({
    id: crypto.randomUUID(),
    correlationId,
    type: 'deploy:pr',
    sourceAgent: 'review-agent',
    targetAgent: 'pr-agent',
    priority,
    payload: {
      intentId: state.intentId,
      projectId,
      intentText: textForDispatch,
      artifacts: state.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        content: a.content,
      })),
      // Pipeline-feedback resume — forwarded so pr-agent pushes to
      // the existing branch + reuses the open PR instead of opening
      // a new one (mirrors legacy `dispatchDeployPR`).
      resumeOnBranch: state.resumeOnBranch ?? undefined,
      prNumber: state.prNumber ?? undefined,
      prUrl: state.prUrl ?? undefined,
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }, queueConfig);

  childLog.info(
    {
      intentId: state.intentId,
      artifactCount: state.artifacts.length,
      dispatchedBy: 'gate-graph',
    },
    'gateNode pass (legacy pre-CI) — dispatched deploy:pr via graph',
  );
}

/**
 * Create the GOLDEN_PRINCIPLE_BREACH alert when the gate escalates.
 * Lifted from `createBreachAlert` in gate-orchestrator.ts. Lives in
 * the deciding node (TR_053 Fix-6 rule) so a resume cannot
 * duplicate the row.
 *
 * Failure is non-fatal — the intent is already escalated, so a
 * missing alert is worse UX but not data loss.
 */
async function createBreachAlertInGraph(args: {
  correlationId: string;
  intentId: string;
  gateSignals: GateSignal[];
}): Promise<void> {
  const { correlationId, intentId, gateSignals } = args;
  const breachSignals = gateSignals.filter(
    (s) => s.type === 'GOLDEN_PRINCIPLE_BREACH',
  );
  if (breachSignals.length === 0) {
    log.warn(
      { correlationId, intentId },
      'gateNode escalate path called without any GP_BREACH signals — skipping alert',
    );
    return;
  }
  const primary = breachSignals[0]!;
  const description = breachSignals.length === 1
    ? primary.message
    : `${breachSignals.length} golden-principle breach(es) require review. First: ${primary.message}`;
  try {
    const { alerts } = getRepositories();
    const alert = await alerts.create({
      correlationId,
      intentId,
      type: 'GOLDEN_PRINCIPLE_BREACH' as AlertType,
      severity: 'critical',
      title: 'Quality gate escalated — golden-principle breach',
      description,
      requiredAction: 'acknowledge-breach' as AlertRequiredAction,
      context: {
        intentId,
        breachSignalIds: breachSignals.map((s) => s.id),
        breachAgent: primary.agentRole,
        triggeredBy: 'gate-graph-escalate',
      },
    });
    emitLiveEvent('alert.created', correlationId, {
      alertId: alert.id,
      type: 'GOLDEN_PRINCIPLE_BREACH',
      intentId,
      severity: 'critical',
    });
    log.info(
      { alertId: alert.id, breachCount: breachSignals.length, intentId },
      'GP_BREACH alert created in gateNode (TR_053 Fix-6 — deciding node owns the alert)',
    );
  } catch (err) {
    log.warn(
      { err, intentId, breachCount: breachSignals.length },
      'createBreachAlertInGraph failed — intent stays escalated but alert is missing',
    );
  }
}

/**
 * Run the gate agents and produce a verdict. Returns a
 * `Partial<GateGraphStateType>` that LangGraph's reducer merges
 * into the running state.
 *
 * Single per-node temp directory — cloned + cleaned up here. The
 * cleanup runs in a `finally` so even an early throw won't leak.
 */
export async function gateNode(
  state: GateGraphStateType,
): Promise<Partial<GateGraphStateType>> {
  const startedAt = new Date();
  const childLog = createContextLogger({
    module: 'gate-graph-node',
    correlationId: state.correlationId,
  });

  childLog.info(
    { intentId: state.intentId, branch: state.branch ?? null },
    'gateNode started — invoking constraint + review',
  );

  let workDir: string | null = null;
  const errors: string[] = [];

  try {
    // ─── 1. Resolve project + token ──────────────────────────────
    const project = await resolveProjectFor(state.intentId);
    if (!project) {
      const reason = `Cannot resolve project for intent ${state.intentId}`;
      childLog.error(reason);
      errors.push(`resolveProject: ${reason}`);
      return {
        gateVerdict: syntheticFailureVerdict(
          reason,
          Date.now() - startedAt.getTime(),
        ),
        errors,
      };
    }

    // ─── 2. Clone + checkout PR branch ───────────────────────────
    workDir = await mkdtemp(join(tmpdir(), `gestalt-gate-graph-${state.correlationId}-`));
    const cloneUrl = authenticatedGitUrl(project.gitUrl, project.token);
    childLog.info({ workDir }, 'gateNode: cloning project repo');
    await simpleGit().clone(cloneUrl, workDir);

    if (state.branch) {
      const repo = simpleGit(workDir);
      try {
        await repo.fetch('origin', state.branch);
        await repo.checkout(['-B', state.branch, `origin/${state.branch}`]);
        childLog.info(
          { branch: state.branch },
          'gateNode: checked out PR branch for review',
        );
      } catch (err) {
        // Non-fatal — gate still reviews the default branch.
        childLog.warn(
          { err: err instanceof Error ? err.message : String(err), branch: state.branch },
          'gateNode: failed to checkout PR branch — reviewing default branch',
        );
      }
    }

    // ─── 3. Resolve intent text ──────────────────────────────────
    let intentText: string | undefined = state.intentText ?? undefined;
    if (!intentText) {
      const intentRow = await getRepositories().intents.findById(state.intentId);
      intentText = intentRow?.text ?? undefined;
    }

    // ─── 4. HARNESS stack + harnessConfig ────────────────────────
    const stack = await loadHarnessStack(workDir);
    const harnessConfig: GateHarnessConfig = {
      ...defaultGateHarnessConfig(workDir),
      ...(stack ? { stack } : {}),
    };

    // ─── 5. ArtifactRef[] — branch-mode vs legacy carryover ──────
    const gateArtifacts: ArtifactRef[] = state.readFromBranch
      ? await readSourceFilesFromWorkDir(workDir, state.correlationId, childLog)
      : state.artifacts.map((a) => ({
          id: a.id,
          type: a.type,
          path: a.path,
          content: a.content,
        }));
    childLog.info(
      { artifactCount: gateArtifacts.length, mode: state.readFromBranch ? 'branch' : 'artifacts' },
      'gateNode: artifacts resolved',
    );

    // ─── 6. Project-structure brief (TR_036) ─────────────────────
    const projectStructureBrief = await buildProjectStructureBrief(workDir);

    const gateTask: GateTask = {
      taskId: state.correlationId,        // node has no message.id; use correlationId
      correlationId: state.correlationId,
      artifacts: gateArtifacts,
      harnessConfig,
      ...(intentText !== undefined ? { intentText } : {}),
      projectStructureBrief,
    };

    // ─── 7. ADR-051 — skip review-agent when PR-Agent ran ────────
    const skipReview = await shouldSkipReviewAgent(workDir);
    if (skipReview) {
      childLog.info(
        'ADR-051 — PR-Agent enabled; gate skipping review-agent (constraint-agent still runs)',
      );
    }
    const reviewAgent = skipReview ? null : new ReviewAgent();

    // ─── 8. Run constraint + review in parallel ──────────────────
    //
    // Preserve the existing decoration pattern verbatim so
    // observability matches the legacy handler's row shape.
    const constraintAgent = getConstraintAgentInstance();
    const constraintPromise = runWithObservability(
      'constraint-agent',
      'gate:constraint',
      state.correlationId,
      state.intentId,
      async () => {
        const r = await runConstraintAgent(gateTask);
        const decorated = r as unknown as {
          lastPrompt?: string;
          llmResponse?: string;
          modelUsed?: string;
          tokensUsed?: number;
        };
        if (constraintAgent.lastPrompt) decorated.lastPrompt = constraintAgent.lastPrompt;
        if (constraintAgent.lastLlmResponse) decorated.llmResponse = constraintAgent.lastLlmResponse;
        if (constraintAgent.lastModelUsed) decorated.modelUsed = constraintAgent.lastModelUsed;
        if (constraintAgent.lastTokensUsed > 0) decorated.tokensUsed = constraintAgent.lastTokensUsed;
        if (constraintAgent.lastTokenManagement) {
          (decorated as unknown as { tokenManagement?: unknown }).tokenManagement =
            constraintAgent.lastTokenManagement;
        }
        if (constraintAgent.lastToolCallLog.length > 0) {
          (decorated as unknown as { toolCalls?: typeof constraintAgent.lastToolCallLog }).toolCalls =
            constraintAgent.lastToolCallLog;
        }
        return r;
      },
      childLog,
    );

    const reviewPromise: Promise<GateAgentResult | null> = reviewAgent
      ? runWithObservability(
          'review-agent',
          'gate:review',
          state.correlationId,
          state.intentId,
          async () => {
            const r = await reviewAgent.review(gateTask);
            if (r.reviewArtifact) {
              const { artifacts } = getRepositories();
              await artifacts.save(r.reviewArtifact as unknown as Artifact);
            }
            if (reviewAgent.lastPrompt) r.lastPrompt = reviewAgent.lastPrompt;
            if (reviewAgent.lastLlmResponse) r.llmResponse = reviewAgent.lastLlmResponse;
            if (reviewAgent.lastModelUsed) r.modelUsed = reviewAgent.lastModelUsed;
            if (reviewAgent.lastTokensUsed > 0) {
              (r as unknown as { tokensUsed?: number }).tokensUsed = reviewAgent.lastTokensUsed;
            }
            if (reviewAgent.lastTokenManagement) {
              (r as unknown as { tokenManagement?: unknown }).tokenManagement =
                reviewAgent.lastTokenManagement;
            }
            return r;
          },
          childLog,
        )
      : Promise.resolve(null);

    const [constraintRes, reviewRes] = await Promise.all([
      constraintPromise,
      reviewPromise,
    ]);

    const agentResults = reviewRes ? [constraintRes, reviewRes] : [constraintRes];
    const result = synthesiseGateResult(state.correlationId, agentResults, startedAt);

    // ─── 9. TR_053 NRB-1 — patch errored rows on pass ────────────
    if (result.verdict === 'pass') {
      for (const r of agentResults) {
        const decorated = r as unknown as {
          status?: string;
          _executionId?: string;
          _errorMessage?: string;
        };
        if (decorated.status !== 'errored' || !decorated._executionId) continue;
        const { executions, executionLogs } = getRepositories();
        await executions
          .updateStatus(
            decorated._executionId,
            'completed-with-warning',
            {
              durationMs: r.durationMs,
              startedAt,
              completedAt: new Date(),
            },
          )
          .catch(() => undefined);
        await executionLogs
          .save({
            executionId: decorated._executionId,
            correlationId: state.correlationId,
            agentRole: r.agentRole,
            prompt: null,
            llmResponse: null,
            resultStatus: 'completed-with-warning',
            artifactPaths: [],
            signalTypes: [],
            errorMessage:
              `${r.agentRole} non-blocking failure: ${
                decorated._errorMessage ?? '(unknown)'
              }. Gate verdict was 'pass' from the other gate agent — non-blocking per TR_053 NRB-1.`,
            modelUsed: null,
            toolCalls: [],
          })
          .catch(() => undefined);
        emitLiveEvent('agent.completed', state.correlationId, {
          executionId: decorated._executionId,
          agentRole: r.agentRole,
          status: 'completed-with-warning',
          error: decorated._errorMessage ?? null,
        });
      }
    }

    // ─── 10. gate.completed SSE ──────────────────────────────────
    childLog.info(
      { verdict: result.verdict, signalCount: result.signals.length },
      summariseGateResult(result),
    );
    emitLiveEvent('gate.completed', state.correlationId, {
      intentId: state.intentId,
      verdict: result.verdict,
      signalCount: result.signals.length,
      agentResults: result.agentResults.map((a) => ({
        agentRole: a.agentRole,
        status: a.status,
        signalCount: a.signals.length,
        durationMs: a.durationMs,
      })),
      summary: summariseGateResult(result),
    });

    // ─── 11. Side effects by verdict ─────────────────────────────
    //
    // pass     → transition to 'approved'. NO promotion / PR
    //            dispatch from the graph yet — TODO for the 2b
    //            session when the graph wires pass → DeployGraph
    //            entry. Until then the legacy `handleGateTask` is
    //            the live path that dispatches; this graph runs
    //            alongside but does not get traffic.
    // escalate → transition to 'escalated' + GP_BREACH alert
    //            (TR_053 Fix-6 — alert lives in the deciding node).
    //            Graph wiring (2b) routes escalate to
    //            selfHealingNode AFTER this node returns; the
    //            diagnostician will see this transition + alert
    //            already in place.
    // fail     → DO NOT transition here. selfHealingNode (Path A
    //            retry / Path B fix-intent / escalate) decides the
    //            terminal state. Today's legacy `transitionIntent
    //            ('failed')` lives at the bottom of the catch
    //            chain in handleGateTask — left untouched.
    if (result.verdict === 'pass') {
      await transitionIntent(state.intentId, state.correlationId, 'approved');
      // TR_056 Part 2c — pass-path dispatch from inside the graph.
      // Branches on `readFromBranch` exactly like the legacy
      // `dispatchPromotion` / `dispatchDeployPR` call sites. Leaf
      // action: graph emits the deploy task and ends; deploy owns
      // the lifecycle from here. NEVER throws — internal try/catch
      // mirrors the legacy "best-effort" semantics.
      try {
        await dispatchPostGateFromGraph({
          state,
          intentText,
          childLog,
        });
      } catch (err) {
        childLog.error(
          { err: err instanceof Error ? err.message : String(err), intentId: state.intentId },
          'gateNode pass — post-gate dispatch threw; intent remains approved but deploy was not enqueued',
        );
        errors.push(
          `post-gate-dispatch: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (result.verdict === 'escalate') {
      await transitionIntent(state.intentId, state.correlationId, 'escalated');
      await createBreachAlertInGraph({
        correlationId: state.correlationId,
        intentId: state.intentId,
        gateSignals: result.signals,
      });
    }
    // fail → no transition; conditional edge routes to selfHealingNode.

    // ─── 12. Return Partial<state> ───────────────────────────────
    //
    // priorSignals is the canonical PlatformSignal[] surface the
    // selfHealingNode reads. Convert from GateSignal[].
    const priorSignals: FeedbackSignal[] = result.signals.map(
      gateSignalToPlatformSignal,
    );

    const verdictSummary: GateVerdictSummary = {
      verdict: result.verdict,
      signalCount: result.signals.length,
      signalsJson: JSON.stringify(result.signals),
      summary: summariseGateResult(result),
      durationMs: result.durationMs,
    };

    return {
      gateVerdict: verdictSummary,
      priorSignals,
      errors,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    childLog.error({ err }, 'gateNode: unexpected throw — emitting synthetic fail verdict');
    errors.push(`gateNode-throw: ${reason}`);
    return {
      gateVerdict: syntheticFailureVerdict(
        reason,
        Date.now() - startedAt.getTime(),
      ),
      errors,
    };
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
