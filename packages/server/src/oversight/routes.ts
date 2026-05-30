/**
 * Oversight routes — alerts, interventions, and live event stream.
 * These are the server endpoints that the dashboard consumes.
 *
 * Routes:
 *   GET  /alerts                 — list alerts (filterable)
 *   GET  /alerts/:id             — get alert detail
 *   POST /alerts/:id/acknowledge — mark an alert acknowledged
 *   POST /interventions          — submit a human intervention (stub)
 *
 * /maintenance/runs and /maintenance/trigger are registered by
 * routes/maintenance.ts. /events is registered by routes/events.ts.
 *
 * `POST /interventions` remains aspirational — the clarification flow
 * goes through the dedicated `POST /intents/:id/clarify` endpoint
 * (simpler contract; matches the CLI surface), and breach
 * acknowledgement / promotion approval haven't shipped a UI yet.
 */

import type { FastifyInstance } from 'fastify';
import { getRepositories, createContextLogger } from '@gestalt/core';
import { requireRole } from '../auth/middleware';
import type { InterventionRequest } from './types';

const log = createContextLogger({ module: 'routes:oversight' });

interface ListAlertsQuery {
  acknowledged?: string;  // 'true' | 'false' — defaults to unacknowledged-only
  severity?: string;
}

export async function registerOversightRoutes(app: FastifyInstance): Promise<void> {

  // GET /alerts — defaults to acknowledged=false so the dashboard's
  // "Alerts" tab shows the actionable ones. The dashboard's API client
  // sends `acknowledged: false` explicitly; the default matches.
  app.get<{ Querystring: ListAlertsQuery }>('/alerts', async (request, reply) => {
    const { alerts } = getRepositories();
    const showAcknowledged = request.query.acknowledged === 'true';
    const all = showAcknowledged
      ? []  // intentional: today the dashboard only consumes unacknowledged;
            // the wire shape leaves room to broaden later without a
            // breaking change
      : await alerts.findUnacknowledged();
    const severityFilter = request.query.severity;
    const filtered = severityFilter
      ? all.filter((a) => a.severity === severityFilter)
      : all;
    return reply.send({ alerts: filtered, total: filtered.length });
  });

  // GET /alerts/:id
  app.get<{ Params: { id: string } }>('/alerts/:id', async (request, reply) => {
    const { alerts } = getRepositories();
    const alert = await alerts.findById(request.params.id);
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    return reply.send(alert);
  });

  // POST /alerts/:id/acknowledge — mark an alert resolved. Used by the
  // dashboard after a successful POST /intents/:id/clarify so the
  // operator sees the alert disappear without needing to refetch.
  app.post<{ Params: { id: string } }>(
    '/alerts/:id/acknowledge',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { alerts, audit } = getRepositories();
      const existing = await alerts.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Alert not found' });
      if (existing.acknowledgedAt) {
        return reply.send({ data: existing });
      }
      const ack = await alerts.acknowledge(existing.id, request.user.id);
      await audit.append({
        actor: request.user.id,
        action: 'alert.acknowledged',
        entityType: 'alerts',
        entityId: ack.id,
        correlationId: ack.correlationId,
        metadata: { type: ack.type, ip: request.ip },
      });
      log.info({ alertId: ack.id, correlationId: ack.correlationId }, 'Alert acknowledged');
      return reply.send({ data: ack });
    },
  );

  // POST /interventions — aspirational. The clarification flow uses
  // POST /intents/:id/clarify instead (it owns the resume side effect).
  app.post<{ Body: InterventionRequest }>('/interventions', async (_req, reply) => {
    return reply.code(501).send({ error: 'POST /interventions not yet implemented — use POST /intents/:id/clarify' });
  });
}
