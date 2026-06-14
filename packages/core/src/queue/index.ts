/**
 * @gestalt/core/queue
 *
 * BullMQ wrappers for the platform message queue.
 * All inter-agent communication goes through this module.
 *
 * Queue names follow the pattern: gestalt-{layer}
 *   gestalt-generate    — generate layer tasks
 *   gestalt-gate        — quality gate tasks
 *   gestalt-deploy      — deploy layer tasks
 *   gestalt-maintenance — maintenance agent tasks
 *
 * Hyphens (not colons) because BullMQ 5.x rejects queue names containing
 * ':' — it reserves the colon for its own Redis key separator.
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import type { Job, WorkerOptions, QueueOptions } from 'bullmq';
import type { TaskMessage, TaskResult, TaskType, TaskPriority } from '../types';
import type { QueueConfig } from '../config/index';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'queue' });

// ─── Queue names ──────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  generate:    'gestalt-generate',
  gate:        'gestalt-gate',
  deploy:      'gestalt-deploy',
  maintenance: 'gestalt-maintenance',
  /**
   * Planning queue (migration 024). Carries `planning:start`,
   * `planning:phase`, and `planning:evaluate` tasks dispatched by
   * the planning orchestrator and the deploy → planning callback.
   */
  planning:    'gestalt-planning',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

// ─── Priority mapping ─────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<TaskPriority, number> = {
  critical:   1,
  high:       2,
  normal:     3,
  background: 10,
};

// ─── Connection options ───────────────────────────────────────────────────────

function buildConnection(config: QueueConfig): { connection: { url: string } } {
  return { connection: { url: config.redisUrl } };
}

// ─── Queue factory ────────────────────────────────────────────────────────────

const _queues = new Map<string, Queue>();

/**
 * Returns a named BullMQ queue. Creates it if it doesn't exist.
 * Queues are singletons — safe to call multiple times with the same name.
 */
export function getQueue(name: QueueName, config: QueueConfig): Queue {
  if (_queues.has(name)) return _queues.get(name)!;

  const opts: QueueOptions = {
    ...buildConnection(config),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  };

  const queue = new Queue(name, opts);
  _queues.set(name, queue);
  log.info({ queue: name }, 'Queue created');
  return queue;
}

// ─── Process-scope QueueConfig pinning ────────────────────────────────────────
//
// `dispatch(message, config)` takes the config explicitly so callers
// can be tested without a global. But code paths that have no
// natural access to config (e.g. the self-healing loop in core that
// runs inside agent code, far from server boot) need a shared
// reference. `setQueueConfig` is called once at server startup; every
// downstream consumer reads it via `getQueueConfig`.
//
// Mirrors the `setMasterKey` / `getMasterKey` and
// `setLLMRegistryResolver` / `getLLMClientForModel` patterns.

let _queueConfig: QueueConfig | null = null;

/**
 * Pin a process-wide `QueueConfig`. Called once at server startup
 * (after config load). Re-calling overwrites — useful for tests.
 */
export function setQueueConfig(config: QueueConfig): void {
  _queueConfig = config;
  log.debug({ redisUrl: config.redisUrl ? '<set>' : '<unset>' }, 'QueueConfig pinned');
}

/**
 * Returns the pinned QueueConfig. Throws when called before
 * `setQueueConfig` — typically only the server's startup ordering
 * could violate this (boot logs surface the trace cleanly).
 */
export function getQueueConfig(): QueueConfig {
  if (!_queueConfig) {
    throw new Error('QueueConfig not initialised — call setQueueConfig(config) at startup');
  }
  return _queueConfig;
}

/** Test helper. */
export function _resetQueueConfig(): void {
  _queueConfig = null;
}

// ─── Task dispatch ────────────────────────────────────────────────────────────

/**
 * Dispatches a typed TaskMessage to the appropriate queue.
 * Returns the BullMQ job ID.
 */
export async function dispatch<TPayload>(
  message: TaskMessage<TPayload>,
  config: QueueConfig,
): Promise<string> {
  const queueName = resolveQueueName(message.type);
  const queue = getQueue(queueName, config);

  const job = await queue.add(message.type, message, {
    priority: PRIORITY_MAP[message.priority],
    jobId: message.id,
    delay: 0,
  });

  log.debug(
    { jobId: job.id, taskType: message.type, correlationId: message.correlationId },
    'Task dispatched',
  );

  return job.id ?? message.id;
}

// ─── Worker factory ───────────────────────────────────────────────────────────

/**
 * ADR-058 clause 2 — per-queue transport defaults.
 *
 * Every queue's `lockDuration` MUST be at or above its worst-case
 * synchronous in-process step, and every queue's `maxStalledCount`
 * MUST be a deliberate choice (not the BullMQ default of 1).
 *
 * Worst-case reasoning per queue:
 *
 *   - `gestalt-planning` — 30 min. `planning:graph-start` runs the
 *     full ArchitectureGraph + planner + per-phase architecture +
 *     phase-dispatch before hitting `awaitPhaseNode`'s interrupt;
 *     ~20–25 min on the trackeros baseline (TR_053 amendment).
 *     Matches the in-orchestrator override at planning-orchestrator.ts
 *     so the default and the override agree.
 *
 *   - `gestalt-generate` — 30 min. The handler runs Aider as a
 *     subprocess via `executeScript`; the actual ceiling stack is:
 *       Aider CLI `--timeout 600` (10 min per LLM call)
 *       + multiple LLM turns in a single Aider run
 *       + adapter `DEFAULT_AIDER_TIMEOUT_MS = 900_000` (15 min)
 *       + `MAX_SCRIPT_TIMEOUT_MS = 900_000` (15 min) clamp.
 *     TR_050 observed a code-agent run of 1233s (~20.5 min) on
 *     trackeros. Add intent-agent / design-agent / context-agent
 *     LLM calls (~1–2 min combined) + scope reduction retries.
 *     Worst-case ~22 min; 30 min = ~36% headroom (TR_056-2c).
 *
 *   - `gestalt-deploy` — 30 min. `pipeline-agent` polls external CI
 *     up to `DEFAULT_TIMEOUT_MS = 600_000` (10 min); on a
 *     self-healing `extendTimeout` hint that doubles to 20 min.
 *     pr-agent clone + PR-Agent subprocess adds ~30–60s; promotion-
 *     agent adds ~1 min. Worst-case ~22 min; 30 min = ~36% headroom.
 *     The under-configured 10-min ceiling was the trigger for
 *     TR_054 #13.1 (TR_056-2c live demo: clone flake stalled
 *     deploy past lockDuration, self-healing re-dispatched into
 *     the same stall, ~95 min wall-clock lost without reaching gate).
 *
 *   - `gestalt-gate` — 10 min. Constraint-agent + review-agent
 *     parallel LLM calls; gate's selfHealingNode (post TR_056-2c)
 *     can pile on a diagnose call with truncation retries but the
 *     loop's own LLM_TIMEOUT_MS ceiling caps each turn. Worst-case
 *     ~6–8 min observed; 10 min headroom retained. Bumping deferred
 *     until live evidence demands it.
 *
 *   - `gestalt-maintenance` — 10 min. Drift / alignment / gc /
 *     evaluation runs are short scheduled LLM calls; the platform
 *     default suffices.
 *
 * `maxStalledCount: 0` everywhere — DELIBERATE. The duplicate-handler
 * risk is asymmetric: a non-zero value means a stalled job is
 * re-dispatched into the SAME handler invocation while the previous
 * one may still be making side effects (DB writes, BullMQ dispatches,
 * intent-status transitions). TR_050 caught this on the planning
 * queue: a stall under `maxStalledCount: 1` ran handlePlanningTask
 * twice, both inserted feature_phases rows, the second hit the
 * `unique(feature_id, phase_index)` constraint, and the cycle died
 * with a duplicate-key error.
 *
 * The tradeoff: with `maxStalledCount: 0` a genuine stall (worker
 * dies mid-handler) fails terminally instead of recovering. We
 * accept that — ADR-058 puts long-term recoverability on the
 * LangGraph checkpointer, not on BullMQ stall-retry. As more
 * layers convert to subgraphs, restart-resume becomes the answer
 * to "what happens if a worker dies", not a queue retry budget.
 *
 * Per-queue `lockDuration` here is the **default**; callers can
 * still override via the `options` argument (e.g. planning's local
 * override at planning-orchestrator.ts continues to win even though
 * the default below matches it — defensive, no behaviour change).
 */
const QUEUE_LOCK_DURATIONS: Record<QueueName, number> = {
  [QUEUE_NAMES.generate]:    1_800_000, // 30 min — Aider ~20 min + LLM steps + retries (TR_050/TR_056-2c)
  [QUEUE_NAMES.gate]:          600_000, // 10 min — parallel constraint+review LLM calls
  [QUEUE_NAMES.deploy]:      1_800_000, // 30 min — CI poll up to 20 min (extendTimeout) + clone + PR-Agent (TR_054 #13.1)
  [QUEUE_NAMES.maintenance]:   600_000, // 10 min — short scheduled LLM calls
  [QUEUE_NAMES.planning]:    1_800_000, // 30 min — ArchitectureGraph + planner + per-phase ~20-25 min (TR_053)
};

/**
 * ADR-058 clause 2 — per-queue stalled-retry policy. All queues
 * pin `maxStalledCount: 0` for the reason documented above. Kept
 * as a per-queue map for future flexibility (a clearly diagnosed
 * "transient stall, no side-effect risk" queue could be raised
 * later with explicit reasoning).
 */
const QUEUE_MAX_STALLED_COUNT: Record<QueueName, number> = {
  [QUEUE_NAMES.generate]:    0,
  [QUEUE_NAMES.gate]:        0,
  [QUEUE_NAMES.deploy]:      0,
  [QUEUE_NAMES.maintenance]: 0,
  [QUEUE_NAMES.planning]:    0,
};

export type TaskHandler<TPayload = unknown, TOutput = unknown> = (
  message: TaskMessage<TPayload>,
  jobId: string,
) => Promise<TaskResult<TOutput>>;

/**
 * Creates an ephemeral BullMQ worker for a specific queue.
 * The worker processes one job at a time by default (concurrency: 1).
 * Each worker is a separate Node.js process in production.
 */
export function createWorker<TPayload = unknown, TOutput = unknown>(
  queueName: QueueName,
  handler: TaskHandler<TPayload, TOutput>,
  config: QueueConfig,
  options?: Partial<WorkerOptions>,
): Worker {
  const worker = new Worker<TaskMessage<TPayload>>(
    queueName,
    async (job: Job<TaskMessage<TPayload>>) => {
      const message = job.data;
      const childLog = createContextLogger({
        module: 'worker',
        queue: queueName,
        taskType: message.type,
        correlationId: message.correlationId,
        jobId: job.id,
      });

      childLog.info('Worker picked up task');

      try {
        const result = await handler(message, job.id ?? message.id);
        childLog.info(
          { status: result.status, durationMs: result.durationMs },
          'Task completed',
        );
        return result;
      } catch (error) {
        childLog.error({ error }, 'Worker threw unexpected error');
        throw error;
      }
    },
    {
      ...buildConnection(config),
      concurrency: 1,
      // ADR-058 clause 2 — per-queue lockDuration + maxStalledCount.
      // The map above documents the worst-case reasoning per queue.
      // BullMQ's defaults (lockDuration: 30000, maxStalledCount: 1)
      // mark any job whose handler runs > ~30s as STALLED and
      // re-dispatch it into a duplicate handler invocation — exactly
      // the asymmetric duplicate-handler risk that TR_050 caught on
      // the planning queue's unique(feature_id, phase_index)
      // constraint. The map sets the floor; callers may still
      // override via `options` (planning-orchestrator.ts does so
      // defensively even though the default below already matches).
      lockDuration: QUEUE_LOCK_DURATIONS[queueName],
      maxStalledCount: QUEUE_MAX_STALLED_COUNT[queueName],
      ...options,
    },
  );

  worker.on('failed', (job, error) => {
    log.error(
      { jobId: job?.id, error: error.message, queue: queueName },
      'Job failed',
    );
  });

  log.info({ queue: queueName }, 'Worker started');
  return worker;
}

// ─── Queue events (for server-side monitoring) ────────────────────────────────

/**
 * Creates a QueueEvents listener for dashboard live updates.
 * Emits events that the oversight layer SSE stream subscribes to.
 */
export function createQueueEventListener(
  queueName: QueueName,
  config: QueueConfig,
): QueueEvents {
  return new QueueEvents(queueName, buildConnection(config));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveQueueName(taskType: TaskType): QueueName {
  if (taskType.startsWith('generate:')) return QUEUE_NAMES.generate;
  if (taskType.startsWith('gate:'))     return QUEUE_NAMES.gate;
  if (taskType.startsWith('deploy:'))   return QUEUE_NAMES.deploy;
  if (taskType.startsWith('maintenance:')) return QUEUE_NAMES.maintenance;
  if (taskType.startsWith('planning:')) return QUEUE_NAMES.planning;
  throw new Error(`Cannot resolve queue for unknown task type: ${taskType}`);
}
