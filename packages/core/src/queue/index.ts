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
  throw new Error(`Cannot resolve queue for unknown task type: ${taskType}`);
}
