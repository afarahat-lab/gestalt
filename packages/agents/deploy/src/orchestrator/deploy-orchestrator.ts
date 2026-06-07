/**
 * Deploy-layer orchestrator — BullMQ worker.
 *
 * Drains `bull:gestalt-deploy:*`. Consumes three task types dispatched
 * across the deploy lifecycle:
 *
 *   - `deploy:pr`         — gate dispatches this on a `pass` verdict.
 *                           pr-agent clones, branches, pushes, opens PR.
 *                           On success, this orchestrator dispatches
 *                           `deploy:pipeline`.
 *   - `deploy:pipeline`   — pipeline-agent triggers + polls CI. On
 *                           `passed`, this orchestrator dispatches
 *                           `deploy:promotion` (staging). On `failed`
 *                           or `timeout`, intent → `failed`.
 *   - `deploy:promotion`  — promotion-agent promotes to the requested
 *                           environment. ADR-034: production requires a
 *                           prior `promoted-staging` row. After staging
 *                           we dispatch a second `deploy:promotion` for
 *                           production; after production the intent
 *                           transitions to `deployed`.
 *
 * Observability follows the same shape as the generate and gate
 * orchestrators: one `agent_executions` row per agent task (running →
 * completed/failed), signals saved to the `signals` table, SSE events
 * for every transition (`agent.started`, `agent.completed`,
 * `signal.emitted`, `deployment.updated`, `intent.status-changed`).
 */

import {
  createWorker, dispatch, getRepositories,
  createContextLogger, emitLiveEvent, QUEUE_NAMES,
  runSelfHealingLoop,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig, TaskPriority,
  PlatformSignal, ExecutionStatus, IntentStatus,
  FailureType,
} from '@gestalt/core';
import { runPRAgent } from '../agents/pr-agent';
import type { PRAgentSelfHealingHints } from '../agents/pr-agent';
import { runPipelineAgent } from '../agents/pipeline-agent';
import type { PipelineAgentSelfHealingHints } from '../agents/pipeline-agent';
import { runPromotionAgent } from '../agents/promotion-agent';
import type { PromotionAgentSelfHealingHints } from '../agents/promotion-agent';
import { PipelineAdapterAuthError } from '../adapters/pipeline-adapter';

const log = createContextLogger({ module: 'deploy-orchestrator' });

// ─── Task payload shapes ─────────────────────────────────────────────────────

/**
 * Shared self-healing payload fields (Option B). Present ONLY on
 * retry dispatches the loop produced — fresh cycles never carry
 * them. Target agents read `selfHealingHints` and apply only the
 * keys they recognise; unknown hints are silently ignored so a
 * future diagnosis adding a new hint doesn't crash old workers.
 */
interface SelfHealingDispatchFields {
  /**
   * Dispatch source. `'self-healing'` ⇒ retry from the loop's
   * regular path. `'auto-resolved'` ⇒ retry from the
   * auto-resolver inside `escalateToHuman`. Both flow through the
   * same agent code paths; the source field is for the audit
   * trail + dashboard "Attempt history" rendering only.
   */
  source?: 'self-healing' | 'auto-resolved' | 'operator-resume' | 'pipeline-feedback' | 'human' | 'maintenance-agent';
  /** Hint object the diagnostician emitted. Optional. */
  selfHealingHints?: Record<string, unknown>;
  /** Short diagnosis string for inline logging. Optional. */
  selfHealingDiagnosis?: string;
}

interface DeployPRPayload extends SelfHealingDispatchFields {
  intentId: string;
  projectId: string;
  intentText: string;
  artifacts: Array<{ id?: string; type?: string; path: string; content: string }>;
  /**
   * Set by the self-healing loop on `deploy:pr` retry dispatches.
   * pr-agent's recovery path reads this AND `selfHealingHints`
   * to decide whether to push to the existing branch (with
   * --force-with-lease, --unshallow etc.) instead of writing a
   * fresh branch. Same field the pipeline-feedback resume flow
   * already uses on `generate:intent` retries.
   */
  resumeOnBranch?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  /**
   * TEST_REPORT_020 — gate-retry threading. Carries the cycle's
   * retry counter + the signals from the previous gate round
   * forward through the deploy chain so the next gate:review entry
   * sees the right `retryCount` (was previously dropped at every
   * generate→deploy:pr hop, causing the TR_019 runaway loop).
   */
  retryCount?: number;
  priorSignals?: Array<{ type: string; message: string; sourceAgent: string; severity: string }>;
}

interface DeployPipelinePayload extends SelfHealingDispatchFields {
  intentId: string;
  projectId: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  /**
   * Threaded forward to the promotion-agent so it can build the
   * auto-merge commit subject without re-loading the intent. Optional
   * for compat with legacy in-flight queue jobs.
   */
  intentText?: string;
  /** TEST_REPORT_020 — gate-retry threading. See DeployPRPayload. */
  retryCount?: number;
  priorSignals?: Array<{ type: string; message: string; sourceAgent: string; severity: string }>;
}

interface DeployPromotionPayload extends SelfHealingDispatchFields {
  intentId: string;
  projectId: string;
  targetEnvironment: 'staging' | 'production';
  /**
   * PR opened by pr-agent for this cycle. Threaded through
   * pipeline-agent so the promotion-agent can call
   * `adapter.mergePullRequest` when `HARNESS.json`
   * `pipeline.autoMerge === true`. Optional because legacy in-flight
   * BullMQ jobs queued before the auto-merge feature shipped do not
   * carry it; the promotion-agent treats a missing `prNumber` the
   * same as `autoMerge: false`.
   */
  prNumber?: number;
  /** Optional branch — only present on self-healing retry dispatches. */
  branch?: string;
  /**
   * Intent text used as the merge commit subject when auto-merge fires
   * (`<intentText> [gestalt <corr8>]`). Optional for the same
   * legacy-payload reason as `prNumber`; falls back to a generic
   * subject when absent.
   */
  intentText?: string;
}

type DeployPayload = DeployPRPayload | DeployPipelinePayload | DeployPromotionPayload;
type DeployAgentRole = 'pr-agent' | 'pipeline-agent' | 'promotion-agent';

// ─── Worker entry point ──────────────────────────────────────────────────────

export function startDeployWorker(queueConfig: QueueConfig): void {
  createWorker<DeployPayload>(
    QUEUE_NAMES.deploy,
    handleDeployTask,
    queueConfig,
    { concurrency: 2 },
  );
  log.info('Deploy worker started');
}

// ─── Routing + dispatch ──────────────────────────────────────────────────────

async function handleDeployTask(
  message: TaskMessage<DeployPayload>,
): Promise<TaskResult> {
  const { correlationId, type } = message;
  const childLog = createContextLogger({ module: 'deploy-orchestrator', correlationId });
  const startedAt = new Date();

  childLog.info({ taskType: type }, 'Deploy orchestrator received task');

  try {
    if (type === 'deploy:pr') {
      const payload = message.payload as DeployPRPayload;
      const result = await runWithObservability(
        'pr-agent',
        'deploy:pr',
        correlationId,
        payload.intentId,
        () => runPRAgent({
          correlationId,
          intentId: payload.intentId,
          projectId: payload.projectId,
          intentText: payload.intentText,
          artifacts: payload.artifacts.map((a) => ({ path: a.path, content: a.content })),
          // Self-healing retry forwarding (Option B). All four
          // fields are optional and present only on dispatches
          // the loop produced; fresh `deploy:pr` cycles pass
          // them as undefined and pr-agent ignores them.
          resumeOnBranch: payload.resumeOnBranch,
          prNumber: payload.prNumber,
          prUrl: payload.prUrl,
          selfHealingHints: payload.selfHealingHints as PRAgentSelfHealingHints | undefined,
          selfHealingDiagnosis: payload.selfHealingDiagnosis,
        }),
        [],
        childLog,
      );
      // Hand off to pipeline-agent.
      await dispatch({
        id: crypto.randomUUID(),
        correlationId,
        type: 'deploy:pipeline',
        sourceAgent: 'pr-agent',
        targetAgent: 'pipeline-agent',
        priority: (message.priority ?? 'normal') as TaskPriority,
        payload: {
          intentId: payload.intentId,
          projectId: payload.projectId,
          branch: result.branch,
          prUrl: result.prUrl,
          prNumber: result.prNumber,
          // Forward for the eventual auto-merge commit subject.
          intentText: payload.intentText,
          // TR_020 — gate-retry threading.
          retryCount: payload.retryCount,
          priorSignals: payload.priorSignals,
        } satisfies DeployPipelinePayload,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }, queueConfigFromEnv());
      return buildTaskResult(message, 'completed', startedAt);
    }

    if (type === 'deploy:pipeline') {
      const payload = message.payload as DeployPipelinePayload;
      const result = await runWithObservability(
        'pipeline-agent',
        'deploy:pipeline',
        correlationId,
        payload.intentId,
        () => runPipelineAgent({
          correlationId,
          intentId: payload.intentId,
          projectId: payload.projectId,
          branch: payload.branch,
          prUrl: payload.prUrl,
          prNumber: payload.prNumber,
          intentText: payload.intentText,
          // Self-healing recovery — forward hints + diagnosis.
          // Fresh cycles pass undefined; pipeline-agent skips
          // the hint code paths unchanged.
          selfHealingHints: payload.selfHealingHints as PipelineAgentSelfHealingHints | undefined,
          selfHealingDiagnosis: payload.selfHealingDiagnosis,
        }),
        (r) => r.signals,
        childLog,
      );
      if (result.outcome.kind !== 'passed') {
        // Self-healing (migration 020) — diagnose + maybe-retry +
        // maybe-escalate-with-auto-resolve. Replaces the prior
        // pipeline-agent direct alert creation; the loop's
        // `escalateToHuman` writes the same shape using
        // `alertContextExtras` to carry runId + pipelineStatus.
        const failureType: FailureType =
          result.outcome.kind === 'timeout' ? 'pipeline-timeout' : 'pipeline-failed';
        const reason =
          result.outcome.kind === 'failed' ? result.outcome.reason
          : result.outcome.kind === 'cancelled' ? 'CI run cancelled'
          : 'CI run did not complete within timeout';
        const healing = await attemptSelfHealingForDeploy({
          intentId: payload.intentId,
          correlationId,
          failureType,
          failureSummary:
            `CI pipeline outcome=${result.outcome.kind} for run ${result.outcome.runId}. ${reason}`,
          alertContextExtras: {
            runId: result.outcome.runId,
            pipelineStatus: result.outcome.pipelineStatus,
            adapter: 'github-actions',
          },
          childLog,
        });
        if (!healing.retryDispatched) {
          await transitionIntent(payload.intentId, correlationId, 'failed');
        }
        return buildTaskResult(message, healing.retryDispatched ? 'completed' : 'failed', startedAt);
      }
      // ADR-041 — CI passed; dispatch the LLM quality gate to
      // review the code on the PR branch. Gate runs constraint-agent
      // + review-agent against the actual committed source files
      // (loaded via `readFromBranch: true`), not the artifact set
      // generate produced. On pass the gate dispatches
      // deploy:promotion (staging); on fail it triggers
      // self-healing → Aider regenerates on the same branch → CI
      // re-runs → gate re-runs.
      await transitionIntent(payload.intentId, correlationId, 'in-review');
      await dispatch({
        id: crypto.randomUUID(),
        correlationId,
        type: 'gate:review',
        sourceAgent: 'pipeline-agent',
        targetAgent: 'review-agent',
        priority: (message.priority ?? 'normal') as TaskPriority,
        payload: {
          intentId: payload.intentId,
          projectId: payload.projectId,
          // Empty artifact array — gate reads source files from the
          // branch directly under ADR-041.
          artifacts: [],
          readFromBranch: true,
          branch: payload.branch,
          prNumber: payload.prNumber,
          prUrl: payload.prUrl,
          ciRunId: result.outcome.runId,
          text: payload.intentText,
          // TR_020 — thread the cycle's retry counter forward so the
          // gate's MAX_GATE_RETRIES budget actually fires. Was dropped
          // by every generate→deploy:pr→deploy:pipeline→gate:review hop
          // pre-TR_020, which caused the TR_019 46-round runaway loop.
          retryCount: payload.retryCount,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }, queueConfigFromEnv());
      return buildTaskResult(message, 'completed', startedAt);
    }

    if (type === 'deploy:promotion') {
      const payload = message.payload as DeployPromotionPayload;
      const result = await runWithObservability(
        'promotion-agent',
        `deploy:promotion:${payload.targetEnvironment}`,
        correlationId,
        payload.intentId,
        () => runPromotionAgent({
          correlationId,
          intentId: payload.intentId,
          projectId: payload.projectId,
          targetEnvironment: payload.targetEnvironment,
          prNumber: payload.prNumber,
          intentText: payload.intentText,
          // Self-healing recovery — forward hints + diagnosis.
          selfHealingHints: payload.selfHealingHints as PromotionAgentSelfHealingHints | undefined,
          selfHealingDiagnosis: payload.selfHealingDiagnosis,
        }),
        (r) => r.signals,
        childLog,
      );
      if (result.outcome.kind === 'blocked') {
        // ADR-034 enforcement fired — escalate, do not retry.
        await transitionIntent(payload.intentId, correlationId, 'escalated');
        return buildTaskResult(message, 'failed', startedAt);
      }
      if (payload.targetEnvironment === 'staging') {
        // Chain to production. prNumber + intentText are no longer
        // strictly needed here (the auto-merge fires inside the staging
        // promotion, not production) — but threading them keeps the
        // payload shape uniform and means the production agent can
        // still emit deployment events with prNumber populated.
        await dispatch({
          id: crypto.randomUUID(),
          correlationId,
          type: 'deploy:promotion',
          sourceAgent: 'promotion-agent',
          targetAgent: 'promotion-agent',
          priority: (message.priority ?? 'normal') as TaskPriority,
          payload: {
            intentId: payload.intentId,
            projectId: payload.projectId,
            targetEnvironment: 'production',
            prNumber: payload.prNumber,
            intentText: payload.intentText,
          } satisfies DeployPromotionPayload,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        }, queueConfigFromEnv());
      } else {
        // Production promotion complete → intent is fully deployed.
        await transitionIntent(payload.intentId, correlationId, 'deployed');
      }
      return buildTaskResult(message, 'completed', startedAt);
    }

    throw new Error(`Deploy orchestrator received unknown task type: ${type}`);
  } catch (err) {
    childLog.error({ err, taskType: type }, 'Deploy orchestrator error');
    const payload = message.payload as { intentId?: string };
    if (err instanceof PipelineAdapterAuthError && payload.intentId) {
      // PAT scope error — configuration problem, never retry. Save a
      // GOLDEN_PRINCIPLE_BREACH signal so the operator sees exactly what
      // needs to change, then escalate.
      await escalateAuthError(err, correlationId, payload.intentId, type).catch(() => undefined);
      return buildTaskResult(message, 'failed', startedAt);
    }
    if (payload.intentId) {
      // Self-healing (migration 020) wraps the generic deploy
      // catch block. Same shape as the pipeline-failed branch
      // above but with failureType 'deploy-error'.
      const healing = await attemptSelfHealingForDeploy({
        intentId: payload.intentId,
        correlationId,
        failureType: 'deploy-error',
        failureSummary: `Deploy orchestrator threw on ${type}`,
        technicalDetail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        childLog,
      }).catch(() => ({ retryDispatched: false }));
      if (!healing.retryDispatched) {
        await transitionIntent(payload.intentId, correlationId, 'failed').catch(() => undefined);
      }
      // Don't re-throw when self-healing dispatched a retry — the
      // new cycle is already queued; throwing would tell BullMQ to
      // retry the original job. Return a TaskResult instead.
      if (healing.retryDispatched) {
        return buildTaskResult(message, 'completed', startedAt);
      }
    }
    throw err;
  }
}

async function escalateAuthError(
  err: PipelineAdapterAuthError,
  correlationId: string,
  intentId: string,
  taskType: string,
): Promise<void> {
  const { signals } = getRepositories();
  const sourceAgent: DeployAgentRole =
    taskType === 'deploy:pr'
      ? 'pr-agent'
      : taskType === 'deploy:pipeline'
        ? 'pipeline-agent'
        : 'promotion-agent';
  const signal: PlatformSignal = {
    id: crypto.randomUUID(),
    correlationId,
    type: 'GOLDEN_PRINCIPLE_BREACH',
    severity: 'critical',
    sourceAgent,
    message: err.message,
    autoResolvable: false,
    createdAt: new Date(),
  };
  await signals.save(signal);
  emitLiveEvent('signal.emitted', correlationId, {
    type: signal.type,
    severity: signal.severity,
    sourceAgent: signal.sourceAgent,
    message: signal.message,
  });
  await transitionIntent(intentId, correlationId, 'escalated');
}

// ─── Observability wrapper ───────────────────────────────────────────────────

async function runWithObservability<T>(
  agentRole: DeployAgentRole,
  taskType: string,
  correlationId: string,
  intentId: string,
  invoke: () => Promise<T>,
  extractSignals: PlatformSignal[] | ((result: T) => PlatformSignal[]),
  childLog: ReturnType<typeof createContextLogger>,
): Promise<T> {
  const { executions, signals, executionLogs } = getRepositories();
  const executionId = crypto.randomUUID();
  const startedAt = new Date();

  await executions.create({
    id: executionId,
    correlationId,
    intentId,
    agentRole,
    taskType,
    status: 'running',
    tokensUsed: 0,
    durationMs: null,
    startedAt,
    completedAt: null,
  });
  emitLiveEvent('agent.started', correlationId, {
    executionId,
    agentRole,
    taskType,
    startedAt: startedAt.toISOString(),
  });

  let result: T;
  try {
    result = await invoke();
  } catch (err) {
    const completedAt = new Date();
    await executions.updateStatus(executionId, 'failed', {
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt,
      completedAt,
    }).catch(() => undefined);
    // Deploy agents don't call LLMs — prompt/response are always null.
    // The error message is the operator's only signal.
    await executionLogs.save({
      executionId,
      correlationId,
      agentRole,
      prompt: null,
      llmResponse: null,
      resultStatus: 'failed',
      artifactPaths: [],
      signalTypes: [],
      errorMessage: err instanceof Error ? err.message : String(err),
      modelUsed: null,
      toolCalls: [],
    }).catch(() => undefined);
    emitLiveEvent('agent.completed', correlationId, {
      executionId,
      agentRole,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    childLog.error({ err, agentRole }, 'Deploy agent threw');
    throw err;
  }

  const producedSignals = Array.isArray(extractSignals)
    ? extractSignals
    : extractSignals(result);

  for (const sig of producedSignals) {
    await signals.save(sig);
    emitLiveEvent('signal.emitted', correlationId, {
      executionId,
      agentRole,
      type: sig.type,
      severity: sig.severity,
      sourceAgent: sig.sourceAgent,
      message: sig.message,
    });
  }

  const completedAt = new Date();
  const stepStatus: ExecutionStatus = producedSignals.length > 0 ? 'failed' : 'completed';
  await executions.updateStatus(executionId, stepStatus, {
    durationMs: completedAt.getTime() - startedAt.getTime(),
    startedAt,
    completedAt,
  });
  await executionLogs.save({
    executionId,
    correlationId,
    agentRole,
    prompt: null,           // deploy agents are non-LLM
    llmResponse: null,
    resultStatus: stepStatus,
    artifactPaths: [],      // deploy agents do not produce generate-style artifacts
    signalTypes: producedSignals.map((s) => s.type),
    errorMessage: producedSignals.length > 0
      ? (producedSignals[0]?.message ?? null)
      : null,
    modelUsed: null,        // deploy agents never call the LLM
    toolCalls: [],          // deploy agents don't use tools
  }).catch((err) => {
    childLog.warn({ err, executionId, agentRole }, 'executionLogs.save failed');
  });
  emitLiveEvent('agent.completed', correlationId, {
    executionId,
    agentRole,
    status: stepStatus,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    signalCount: producedSignals.length,
  });

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function transitionIntent(
  intentId: string,
  correlationId: string,
  status: IntentStatus,
): Promise<void> {
  const { intents } = getRepositories();
  await intents.updateStatus(intentId, status);
  emitLiveEvent('intent.status-changed', correlationId, { intentId, status });
}

function buildTaskResult(
  message: TaskMessage<DeployPayload>,
  status: TaskResult['status'],
  startedAt: Date,
): TaskResult {
  return {
    taskId: message.id,
    correlationId: message.correlationId,
    agentRole: 'pr-agent',
    status,
    output: { taskType: message.type },
    signals: [],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt.getTime(),
    completedAt: new Date(),
  };
}

function queueConfigFromEnv(): QueueConfig {
  return { redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };
}

/**
 * Self-healing helper for the deploy layer (migration 020). Same
 * shape as the generate / gate equivalents: returns
 * `{ retryDispatched }`. NEVER throws.
 *
 * Dispatches a fresh `generate:intent` with `source: 'self-healing'`
 * + `resumeOnBranch` so the regeneration sits on top of the
 * existing PR branch — the squash-merge history reads naturally
 * (`fix:` follow-up on the original `feat:` PR).
 */
async function attemptSelfHealingForDeploy(args: {
  intentId: string;
  correlationId: string;
  failureType: FailureType;
  failureSummary: string;
  technicalDetail?: string;
  alertContextExtras?: Record<string, unknown>;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<{ retryDispatched: boolean }> {
  const { intentId, correlationId, failureType, failureSummary, technicalDetail, alertContextExtras, childLog } = args;
  try {
    const repos = getRepositories();
    const intent = await repos.intents.findById(intentId);
    if (!intent) return { retryDispatched: false };

    const signals = await repos.signals.findByCorrelationId(correlationId);
    const artifacts = await repos.artifacts.findByCorrelationId(correlationId);

    const result = await runSelfHealingLoop(
      {
        intentText: intent.text,
        failureType,
        failureSummary,
        technicalDetail,
        attemptNumber: (intent.attemptCount ?? 0) + 1,
        priorSignals: signals.map((s) => ({
          type: s.type,
          message: s.message,
          sourceAgent: s.sourceAgent,
          severity: s.severity,
        })),
        priorArtifactPaths: artifacts.map((a) => a.path),
      },
      {
        failureType,
        correlationId,
        intentId,
        projectId: intent.projectId,
        intentText: intent.text,
        branchName: intent.branchName,
        prNumber: intent.prNumber,
        prUrl: intent.prUrl,
        alertContextExtras,
      },
      signals,
    );

    // Option B (migration 020 amendment): loop owns dispatch +
    // transitionIntent. The dispatched queue varies per
    // diagnosis: pipeline-failed often routes to deploy:pr
    // (push retry with hints) or deploy:pipeline (re-trigger
    // CI) instead of always going back to generate:intent.
    if (result.shouldRetry && !result.escalated && result.diagnosis) {
      childLog.info(
        {
          failureType,
          retryTaskType: result.diagnosis.retryTaskType,
          confidence: result.diagnosis.confidence,
          hintKeys: Object.keys(result.diagnosis.retryPayloadHints ?? {}),
        },
        'Deploy self-healing dispatched retry (loop)',
      );
      return { retryDispatched: true };
    }

    if (result.escalated && result.autoResolved) {
      childLog.info({ failureType }, 'Deploy self-healing auto-resolved escalated alert');
      return { retryDispatched: true };
    }
    return { retryDispatched: false };
  } catch (err) {
    childLog.warn({ err, failureType }, 'Deploy self-healing loop threw — falling through to failed');
    return { retryDispatched: false };
  }
}
