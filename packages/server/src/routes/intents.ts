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
  // Side effects (all required for the resume to look right in the UI):
  //   1. Acknowledge every unacknowledged alert on this correlationId
  //      so the Alerts tab clears immediately
  //   2. Dispatch a fresh `generate:intent` task with `clarification`
  //      threaded through. The orchestrator hydrates the missing
  //      `projectId` + `text` from the persisted intent record, so the
  //      resume payload stays minimal
  //   3. Transition the intent back to `generating`
  //   4. Emit `intent.status-changed` so live dashboards update
  //   5. Audit-log the clarification text (GP-002) so we can answer
  //      "what did the operator say?" later
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

      // 1. Acknowledge in-flight clarification alerts for this cycle.
      const existing = await alerts.findByCorrelationId(intent.correlationId);
      const toAck = existing.filter(
        (a) => a.acknowledgedAt === null && a.type === 'clarification-needed',
      );
      for (const alert of toAck) {
        await alerts.acknowledge(alert.id, request.user.id);
      }

      // 2. Resume the generate loop with clarification text appended.
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
          clarification: clarification.trim(),
          ambiguityId,
          resume: true,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      await dispatch(message, config.queue);

      // 3 + 4. Status transition + SSE.
      await intents.updateStatus(intent.id, 'generating');
      emitLiveEvent('intent.status-changed', intent.correlationId, {
        intentId: intent.id,
        status: 'generating',
      });

      // 5. Audit the clarification (GP-002). Capture the text so the
      // history is reconstructable; truncate to keep the row sane.
      await audit.append({
        actor: request.user.id,
        action: 'intent.clarified',
        entityType: 'intents',
        entityId: intent.id,
        correlationId: intent.correlationId,
        metadata: {
          clarification: clarification.trim().slice(0, 4000),
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
