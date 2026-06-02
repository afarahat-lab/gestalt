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
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig, TaskPriority,
  PlatformSignal, ExecutionStatus, IntentStatus,
} from '@gestalt/core';
import { runPRAgent } from '../agents/pr-agent';
import { runPipelineAgent } from '../agents/pipeline-agent';
import { runPromotionAgent } from '../agents/promotion-agent';
import { PipelineAdapterAuthError } from '../adapters/pipeline-adapter';

const log = createContextLogger({ module: 'deploy-orchestrator' });

// ─── Task payload shapes ─────────────────────────────────────────────────────

interface DeployPRPayload {
  intentId: string;
  projectId: string;
  intentText: string;
  artifacts: Array<{ id?: string; type?: string; path: string; content: string }>;
}

interface DeployPipelinePayload {
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
}

interface DeployPromotionPayload {
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
        }),
        (r) => r.signals,
        childLog,
      );
      if (result.outcome.kind !== 'passed') {
        await transitionIntent(payload.intentId, correlationId, 'failed');
        return buildTaskResult(message, 'failed', startedAt);
      }
      // Pass → dispatch staging promotion. prNumber + intentText are
      // forwarded so the promotion-agent can call mergePullRequest()
      // when HARNESS.json has pipeline.autoMerge === true.
      await dispatch({
        id: crypto.randomUUID(),
        correlationId,
        type: 'deploy:promotion',
        sourceAgent: 'pipeline-agent',
        targetAgent: 'promotion-agent',
        priority: (message.priority ?? 'normal') as TaskPriority,
        payload: {
          intentId: payload.intentId,
          projectId: payload.projectId,
          targetEnvironment: 'staging',
          prNumber: payload.prNumber,
          intentText: payload.intentText,
        } satisfies DeployPromotionPayload,
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
      await transitionIntent(payload.intentId, correlationId, 'failed').catch(() => undefined);
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
