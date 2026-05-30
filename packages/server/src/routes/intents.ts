/**
 * Intent routes.
 *
 * POST /intents          — submit a new intent
 * GET  /intents          — list intents (paginated, filterable)
 * GET  /intents/:id      — get intent detail with agent executions + signals
 * POST /intents/:id/clarify — provide clarification for a CONTEXT_GAP
 */

import type { FastifyInstance } from 'fastify';
import { getRepositories, dispatch, createContextLogger } from '@gestalt/core';
import type { TaskMessage, TaskPriority } from '@gestalt/core';
import { emitLiveEvent } from '../events';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:intents' });

type IntentPriority = 'critical' | 'high' | 'normal' | 'low';

function toTaskPriority(priority: IntentPriority): TaskPriority {
  return priority === 'low' ? 'background' : priority;
}

interface SubmitIntentBody {
  text: string;
  projectId: string;
  priority?: IntentPriority;
}

interface ListIntentsQuery {
  status?: string;
  limit?: string;
  offset?: string;
}

interface ClarifyBody {
  clarification: string;
  /**
   * Optional — only meaningful when the original pause was caused by a
   * specific ambiguity. Today the clarification flow doesn't depend on
   * it (the operator's text is appended to the next intent-agent
   * prompt regardless), but it's recorded in the audit metadata so
   * downstream analytics can correlate.
   */
  ambiguityId?: string;
}

export async function registerIntentRoutes(app: FastifyInstance): Promise<void> {

  // POST /intents — submit a new intent
  app.post<{ Body: SubmitIntentBody }>(
    '/intents',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      const { text, projectId, priority = 'normal' } = request.body;

      if (!text?.trim()) {
        return reply.code(400).send({ error: 'Intent text is required' });
      }
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }

      const { intents } = getRepositories();
      const correlationId = crypto.randomUUID();

      const intent = await intents.create({
        id: crypto.randomUUID(),
        correlationId,
        projectId,
        text: text.trim(),
        status: 'pending',
        source: 'human',
        priority,
      });

      log.info({ intentId: intent.id, correlationId }, 'Intent created');

      // Dispatch to generate layer
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId,
        type: 'generate:intent',
        sourceAgent: 'orchestrator',
        targetAgent: 'intent-agent',
        priority: toTaskPriority(priority),
        payload: { intentId: intent.id, text: intent.text, projectId },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      // Import config lazily to avoid circular deps
      const { loadConfig } = await import('@gestalt/core');
      const config = loadConfig();
      await dispatch(message, config.queue);

      // Update status and notify dashboard
      await intents.updateStatus(intent.id, 'generating');
      emitLiveEvent('intent.created', correlationId, { intentId: intent.id, text, priority });

      return reply.code(201).send({ data: intent });
    },
  );

  // GET /intents — list intents
  app.get<{ Querystring: ListIntentsQuery }>(
    '/intents',
    async (request, reply) => {
      const { status, limit = '20', offset = '0' } = request.query;
      const projectId = (request.query as Record<string, string>)['projectId'] ?? '';

      if (!projectId) {
        return reply.code(400).send({ error: 'projectId is required' });
      }

      const { intents } = getRepositories();
      const { records, total } = await intents.list({
        projectId,
        status: status as never,
        limit: Math.min(parseInt(limit, 10), 100),
        offset: parseInt(offset, 10),
      });

      return reply.send({
        data: records,
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
    },
  );

  // GET /intents/:id — intent detail
  app.get<{ Params: { id: string } }>(
    '/intents/:id',
    async (request, reply) => {
      const { intents, executions, signals, artifacts } = getRepositories();
      const intent = await intents.findById(request.params.id);

      if (!intent) {
        return reply.code(404).send({ error: 'Intent not found' });
      }

      const [agentExecutions, intentSignals, intentArtifacts] = await Promise.all([
        executions.findByCorrelationId(intent.correlationId),
        signals.findByCorrelationId(intent.correlationId),
        artifacts.findByCorrelationId(intent.correlationId),
      ]);

      return reply.send({
        data: {
          ...intent,
          agentExecutions,
          signals: intentSignals,
          artifacts: intentArtifacts,
        },
      });
    },
  );

  // POST /intents/:id/clarify — resolve a clarification-needed pause
  //
  // Side effects:
  //   1. Persist the clarification on the intents row so it survives
  //      gate-retry dispatches (which do NOT carry it in the BullMQ
  //      payload). The orchestrator reads this column on every
  //      dispatch, including retries.
  //   2. Acknowledge every unacknowledged clarification alert on this
  //      correlationId so the Alerts tab clears immediately
  //   3. Dispatch a fresh `generate:intent` task. Payload still
  //      carries `clarification` (so the very first run after this
  //      call can use it before the DB read races against the queue)
  //      but it is no longer load-bearing — the DB is the source of
  //      truth
  //   4. Transition the intent back to `generating`
  //   5. Emit `intent.status-changed` so live dashboards update
  //   6. Audit-log the clarification EVENT (GP-002). The clarification
  //      text itself is NOT written to the audit row — GP-006 (no
  //      sensitive data in logs); only its length. Reconstruct the
  //      "what did they say?" question via direct DB query against
  //      `intents.clarification`
  app.post<{ Params: { id: string }; Body: ClarifyBody }>(
    '/intents/:id/clarify',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { intents, alerts, audit } = getRepositories();
      const intent = await intents.findById(request.params.id);

      if (!intent) {
        return reply.code(404).send({ error: 'Intent not found' });
      }
      if (intent.status !== 'waiting-for-clarification') {
        return reply.code(400).send({
          error: `Cannot clarify intent with status '${intent.status}'`,
        });
      }

      const { clarification, ambiguityId } = request.body;
      if (!clarification?.trim()) {
        return reply.code(400).send({ error: 'clarification text is required' });
      }
      const trimmedClarification = clarification.trim();

      // 1. Persist clarification BEFORE dispatching. If the dispatch
      // fires and the orchestrator wins the race, the DB read still
      // returns the new text.
      await intents.saveClarification(intent.id, trimmedClarification);

      // 2. Acknowledge in-flight clarification alerts for this cycle.
      const existing = await alerts.findByCorrelationId(intent.correlationId);
      const toAck = existing.filter(
        (a) => a.acknowledgedAt === null && a.type === 'clarification-needed',
      );
      for (const alert of toAck) {
        await alerts.acknowledge(alert.id, request.user.id);
      }

      // 3. Resume the generate loop.
      const { loadConfig } = await import('@gestalt/core');
      const config = loadConfig();
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId: intent.correlationId,
        type: 'generate:intent',
        sourceAgent: 'orchestrator',
        targetAgent: 'orchestrator',
        priority: toTaskPriority(intent.priority),
        payload: {
          intentId: intent.id,
          // projectId + text omitted on purpose — the orchestrator
          // hydrates them from `intents.findById` to keep this payload
          // small and consistent with the persisted record.
          clarification: trimmedClarification,
          ambiguityId,
          resume: true,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      await dispatch(message, config.queue);

      // 4 + 5. Status transition + SSE.
      await intents.updateStatus(intent.id, 'generating');
      emitLiveEvent('intent.status-changed', intent.correlationId, {
        intentId: intent.id,
        status: 'generating',
      });

      // 6. Audit-log the EVENT. Capture length so anomaly detectors can
      // flag suspiciously short or empty clarifications; do NOT capture
      // the text itself — GP-006. The text is persisted on the intent
      // row and auditable via direct DB query if forensics ever need it.
      await audit.append({
        actor: request.user.id,
        action: 'intent.clarification-provided',
        entityType: 'intents',
        entityId: intent.id,
        correlationId: intent.correlationId,
        metadata: {
          clarificationLength: trimmedClarification.length,
          ambiguityId: ambiguityId ?? null,
          acknowledgedAlertIds: toAck.map((a) => a.id),
          ip: request.ip,
        },
      });

      return reply.send({
        data: {
          resumed: true,
          acknowledgedAlerts: toAck.length,
        },
      });
    },
  );
}
