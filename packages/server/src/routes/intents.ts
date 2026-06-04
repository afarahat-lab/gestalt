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
import {
  requireRole, checkProjectMembership,
} from '../auth/middleware';

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
  // Existing
  projectId?: string;
  status?: string;
  limit?: string;
  offset?: string;
  // Brief 5 — additional filter params. All are optional; ISO dates
  // for `from` / `to` parse to JS `Date` server-side before reaching
  // the repository.
  source?: string;
  priority?: string;
  search?: string;
  from?: string;
  to?: string;
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
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { text, projectId, priority = 'normal' } = request.body;

      if (!text?.trim()) {
        return reply.code(400).send({ error: 'Intent text is required' });
      }
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }

      // Handler-level membership guard — `requireRole('operator')` only
      // resolves projectId from URL params/query, never from the body,
      // so a regular user could otherwise submit intents against any
      // project they knew the ID of.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'editor')) return;

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

  // GET /intents — list intents (Brief 5 widened)
  //
  // Membership rules:
  //   - With ?projectId=…  → require reader+ on that project (direct
  //     OR group-derived); platform-admin bypasses
  //   - Without projectId  → platform-admin sees the server-wide list
  //     (via intents.listAll). Regular users see intents for EVERY
  //     project they can access via direct membership OR group
  //     assignment (Brief 5). An empty set returns `{data: [], total: 0}`
  //     rather than 403 so the response shape never leaks "project X
  //     exists" by erroring vs returning empty
  //
  // Query filters (all optional):
  //   - status / source / priority — exact match against the typed
  //     column. Source accepts the wider Brief 5 union but most
  //     intents stay at their original `human` / `maintenance-agent`
  //     source on retry cycles
  //   - search — ILIKE '%search%' on the text column
  //   - from / to — ISO date strings; both inclusive bounds on
  //     created_at. Invalid dates fall through with no filter applied
  app.get<{ Querystring: ListIntentsQuery }>(
    '/intents',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const q = request.query;
      const limit = Math.min(parseInt(q.limit ?? '20', 10) || 20, 100);
      const offset = parseInt(q.offset ?? '0', 10) || 0;
      const filters = buildIntentFilters(q, limit, offset);
      const projectId = q.projectId?.trim() ?? '';

      const { intents, memberships, platformGroups } = getRepositories();

      if (!projectId) {
        // Platform-admin: server-wide list across every project
        if (request.user.role === 'platform-admin') {
          const { records, total } = await intents.listAll(filters);
          return reply.send({ data: records, total, limit, offset });
        }

        // Regular user: UNION of direct memberships + group-derived access
        const [direct, viaGroups] = await Promise.all([
          memberships.findByUser(request.user.id),
          platformGroups.getEffectiveMemberships(request.user.id),
        ]);
        const allProjectIds = [
          ...new Set([
            ...direct.map((m) => m.projectId),
            ...viaGroups.map((m) => m.projectId),
          ]),
        ];
        if (allProjectIds.length === 0) {
          return reply.send({ data: [], total: 0, limit, offset });
        }
        const { records, total } = await intents.listForProjects(allProjectIds, filters);
        return reply.send({ data: records, total, limit, offset });
      }

      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId)) return;
      const { records, total } = await intents.list({ projectId, ...filters });
      return reply.send({ data: records, total, limit, offset });
    },
  );

  // GET /intents/:id — intent detail.
  //
  // Membership is checked against the intent's projectId. A user who
  // is NOT a member of the project gets a 403 — NOT a 404. Returning
  // 404 would leak existence by letting non-members enumerate intent
  // IDs to detect which ones map to projects they can't see.
  app.get<{ Params: { id: string } }>(
    '/intents/:id',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { intents, executions, signals, artifacts } = getRepositories();
      const intent = await intents.findById(request.params.id);

      if (!intent) {
        return reply.code(404).send({ error: 'Intent not found' });
      }

      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId)) return;

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

      // Membership guard — `params.id` is the intent UUID, not a project
      // UUID, so `requireRole('operator')` cannot enforce membership
      // here. Resolved manually from the intent record's projectId.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId, 'editor')) return;

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

/**
 * Translate `ListIntentsQuery` into the typed `IntentListFilters`
 * the repositories expect (Brief 5).
 *
 *   - Trims string values + rejects empties so the SQL conditional
 *     `($N IS NULL OR …)` fragments are bypassed
 *   - Parses `from` / `to` via `new Date(...)`. If the result is
 *     `NaN`, the filter is dropped silently — invalid date strings
 *     don't error; the user just sees an unfiltered range. Matches
 *     the brief's permissive approach
 *   - `status` is widened from string at this boundary; the repo's
 *     `IntentListFilters.status` typing constrains downstream callers
 */
function buildIntentFilters(
  q: ListIntentsQuery,
  limit: number,
  offset: number,
): import('@gestalt/core').IntentListFilters {
  const filters: import('@gestalt/core').IntentListFilters = { limit, offset };
  const trimmed = (s: string | undefined): string | undefined => {
    const t = s?.trim();
    return t ? t : undefined;
  };
  const status   = trimmed(q.status);
  const source   = trimmed(q.source);
  const priority = trimmed(q.priority);
  const search   = trimmed(q.search);
  // `status` is an open `IntentStatus` union; the cast widens through
  // unknown so an arbitrary string from the query doesn't break the
  // type. The DB silently ignores unknown statuses (no row matches).
  if (status)   filters.status = status as unknown as import('@gestalt/core').IntentListFilters['status'];
  if (source)   filters.source = source;
  if (priority) filters.priority = priority;
  if (search)   filters.search = search;
  if (q.from) {
    const d = new Date(q.from);
    if (!Number.isNaN(d.getTime())) filters.from = d;
  }
  if (q.to) {
    const d = new Date(q.to);
    if (!Number.isNaN(d.getTime())) filters.to = d;
  }
  return filters;
}
