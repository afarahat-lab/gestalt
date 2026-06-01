/**
 * Oversight routes — alerts, interventions, and live event stream.
 * These are the server endpoints that the dashboard consumes.
 *
 * Routes:
 *   GET  /alerts                  — list alerts (acknowledged filter) with
 *                                   per-type enrichment baked into each row
 *   GET  /alerts/:id              — single alert detail (same enrichment)
 *   POST /alerts/:id/acknowledge  — mark an alert acknowledged + optional notes
 *   POST /alerts/:id/fix-intent   — submit a fix intent built from alert
 *                                   context; acknowledges the alert as part
 *                                   of the same call
 *   POST /interventions           — aspirational stub
 *
 * /maintenance/runs and /maintenance/trigger are registered by
 * routes/maintenance.ts. /events is registered by routes/events.ts.
 *
 * Enrichment shape (all optional — only the keys relevant to the
 * specific alert type are populated):
 *   { ...AlertRecord,
 *     intentText, intentStatus,                      // clarification-needed
 *     findingType, affectedFiles, evidence,
 *     attemptCount, suggestedAction,                 // maintenance-stuck
 *     breachMessage, breachLocation, breachAgent }   // GOLDEN_PRINCIPLE_BREACH
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, dispatch, createContextLogger, loadConfig,
} from '@gestalt/core';
import type {
  AlertRecord, TaskMessage, TaskPriority, CodeLocation,
} from '@gestalt/core';
import { emitLiveEvent } from '../events';
import {
  requireRole, requireProjectMembership, sendProjectMembershipError,
  ProjectMembershipError,
} from '../auth/middleware';
import type { InterventionRequest } from './types';

const log = createContextLogger({ module: 'routes:oversight' });

interface ListAlertsQuery {
  acknowledged?: string;  // 'true' | 'false' — defaults to unacknowledged-only
  severity?: string;
}

interface AcknowledgeBody {
  notes?: string;
}

interface FixIntentBody {
  additionalContext?: string;
}

/**
 * Enriched alert row sent on the wire. The base shape mirrors
 * `AlertRecord` (camelCase via the postgres adapter) plus per-type
 * fields lifted out of `context` so the dashboard / CLI can render
 * without re-parsing the JSONB.
 */
interface EnrichedAlert extends AlertRecord {
  // clarification-needed
  intentText?: string | null;
  intentStatus?: string | null;
  // maintenance-stuck
  findingType?: string | null;
  affectedFiles?: string[] | null;
  evidence?: string | null;
  attemptCount?: number | null;
  suggestedAction?: string | null;
  // GOLDEN_PRINCIPLE_BREACH
  breachMessage?: string | null;
  breachLocation?: CodeLocation | null;
  breachAgent?: string | null;
}

export async function registerOversightRoutes(app: FastifyInstance): Promise<void> {

  // GET /alerts — defaults to acknowledged=false so the dashboard's
  // "Alerts" tab shows the actionable ones. Response shape:
  //   { data: EnrichedAlert[] }
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
    const enriched = await Promise.all(filtered.map(enrichAlert));
    return reply.send({ data: enriched, total: enriched.length });
  });

  // GET /alerts/:id
  app.get<{ Params: { id: string } }>('/alerts/:id', async (request, reply) => {
    const { alerts } = getRepositories();
    const alert = await alerts.findById(request.params.id);
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    const enriched = await enrichAlert(alert);
    return reply.send({ data: enriched });
  });

  // POST /alerts/:id/acknowledge — mark an alert resolved. Used by the
  // dashboard after a successful POST /intents/:id/clarify so the
  // operator sees the alert disappear without needing to refetch.
  // Accepts an optional { notes } body — the audit row captures
  // `notesLength` only (GP-006: the text itself stays out of the audit
  // trail; the persisted alert is the source of truth).
  app.post<{ Params: { id: string }; Body: AcknowledgeBody }>(
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
      const notes = (request.body?.notes ?? '').trim();
      await audit.append({
        actor: request.user.id,
        action: 'alert.acknowledged',
        entityType: 'alerts',
        entityId: ack.id,
        correlationId: ack.correlationId,
        metadata: {
          type: ack.type,
          notesLength: notes.length,
          ip: request.ip,
        },
      });
      emitLiveEvent('alert.acknowledged', ack.correlationId, { alertId: ack.id });
      log.info({ alertId: ack.id, correlationId: ack.correlationId }, 'Alert acknowledged');
      return reply.send({ data: ack });
    },
  );

  // POST /alerts/:id/fix-intent — operator says "I understand the problem,
  // generate a fix". Builds an intent text from the alert's enriched
  // context, dispatches it to the generate queue, then acknowledges
  // the alert so it drops off the unack list atomically with the
  // submission. `additionalContext` is APPENDED to the auto-built
  // intent text — never replaces it — so the structural context the
  // platform synthesised always leads.
  app.post<{ Params: { id: string }; Body: FixIntentBody }>(
    '/alerts/:id/fix-intent',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { alerts, intents, audit } = getRepositories();
      const existing = await alerts.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Alert not found' });
      if (existing.acknowledgedAt) {
        return reply.code(409).send({ error: 'Alert already acknowledged' });
      }
      const enriched = await enrichAlert(existing);
      const additionalContext = (request.body?.additionalContext ?? '').trim();
      const intentText = buildFixIntentText(enriched, additionalContext);
      if (!intentText) {
        return reply.code(400).send({
          error: 'Could not build an actionable fix intent — alert is missing a target file or context',
        });
      }

      // Find the project for this alert. clarification-needed alerts
      // carry the source intent's projectId via context.intentId →
      // intents.findById; maintenance-stuck carries it directly in
      // context.projectId; GP_BREACH alerts inherit the intent's
      // projectId via correlationId → intents.findByCorrelationId.
      const projectId = await resolveProjectIdForAlert(existing, enriched);
      if (!projectId) {
        return reply.code(400).send({
          error: 'Could not resolve projectId for this alert — fix intent cannot be queued',
        });
      }

      // Editor or above required — the fix intent will commit code on
      // the resolved project's repo.
      try {
        await requireProjectMembership(
          request.user.id, request.user.role, projectId, 'editor',
        );
      } catch (err) {
        if (err instanceof ProjectMembershipError) return sendProjectMembershipError(reply, err);
        throw err;
      }

      const correlationId = crypto.randomUUID();
      const intent = await intents.create({
        id: crypto.randomUUID(),
        correlationId,
        projectId,
        text: intentText,
        status: 'pending',
        source: 'human',
        priority: 'normal',
      });

      const config = loadConfig();
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId,
        type: 'generate:intent',
        sourceAgent: 'orchestrator',
        targetAgent: 'intent-agent',
        priority: 'normal' as TaskPriority,
        payload: { intentId: intent.id, text: intentText, projectId },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      await dispatch(message, config.queue);
      await intents.updateStatus(intent.id, 'generating');

      const ack = await alerts.acknowledge(existing.id, request.user.id);

      await audit.append({
        actor: request.user.id,
        action: 'alert.fix-intent-submitted',
        entityType: 'alerts',
        entityId: ack.id,
        correlationId,
        metadata: {
          type: ack.type,
          fixIntentId: intent.id,
          additionalContextLength: additionalContext.length,
          intentTextLength: intentText.length,
          ip: request.ip,
        },
      });

      emitLiveEvent('intent.created', correlationId, {
        intentId: intent.id, text: intentText, priority: 'normal',
        source: 'alert-fix',
      });
      emitLiveEvent('alert.acknowledged', ack.correlationId, { alertId: ack.id });
      log.info(
        { alertId: ack.id, fixIntentId: intent.id, correlationId },
        'Fix intent submitted from alert',
      );

      return reply.send({
        data: {
          intentId: intent.id,
          correlationId,
          intentText,
        },
      });
    },
  );

  // POST /interventions — aspirational. The clarification flow uses
  // POST /intents/:id/clarify instead (it owns the resume side effect).
  app.post<{ Body: InterventionRequest }>('/interventions', async (_req, reply) => {
    return reply.code(501).send({ error: 'POST /interventions not yet implemented — use POST /intents/:id/clarify' });
  });
}

// ─── Enrichment helpers ─────────────────────────────────────────────────────

async function enrichAlert(alert: AlertRecord): Promise<EnrichedAlert> {
  const { intents, signals } = getRepositories();
  const enriched: EnrichedAlert = { ...alert };
  const ctx = alert.context ?? {};

  if (alert.type === 'clarification-needed') {
    const intentId = typeof ctx['intentId'] === 'string' ? (ctx['intentId'] as string) : null;
    if (intentId) {
      const intent = await intents.findById(intentId);
      enriched.intentText = intent?.text ?? null;
      enriched.intentStatus = intent?.status ?? null;
    }
  }

  if (alert.type === 'maintenance-stuck') {
    enriched.findingType = stringOrNull(ctx['intentType']);
    enriched.affectedFiles = Array.isArray(ctx['affectedFiles'])
      ? (ctx['affectedFiles'] as unknown[]).filter((f): f is string => typeof f === 'string')
      : null;
    enriched.evidence = stringOrNull(ctx['evidence']);
    enriched.attemptCount = typeof ctx['attemptCount'] === 'number'
      ? (ctx['attemptCount'] as number)
      : null;
    enriched.suggestedAction = stringOrNull(ctx['suggestedAction']);
  }

  if (alert.type === 'GOLDEN_PRINCIPLE_BREACH' && alert.correlationId) {
    const correlated = await signals.findByCorrelationId(alert.correlationId);
    const breach = correlated.find((s) => s.type === 'GOLDEN_PRINCIPLE_BREACH');
    enriched.breachMessage = breach?.message ?? null;
    enriched.breachLocation = breach?.location ?? null;
    enriched.breachAgent = breach?.sourceAgent ?? null;
  }

  return enriched;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

async function resolveProjectIdForAlert(
  alert: AlertRecord,
  enriched: EnrichedAlert,
): Promise<string | null> {
  const { intents } = getRepositories();
  const ctx = alert.context ?? {};

  // Direct: maintenance-stuck stores projectId in context.
  if (typeof ctx['projectId'] === 'string') return ctx['projectId'] as string;

  // clarification-needed / similar: walk via intent.
  if (alert.intentId) {
    const intent = await intents.findById(alert.intentId);
    if (intent) return intent.projectId;
  }
  if (typeof ctx['intentId'] === 'string') {
    const intent = await intents.findById(ctx['intentId'] as string);
    if (intent) return intent.projectId;
  }
  // GP_BREACH: signals share a correlationId with the original intent.
  if (alert.correlationId) {
    const intent = await intents.findByCorrelationId(alert.correlationId);
    if (intent) return intent.projectId;
  }
  // If the enrichment found the intent text, the intent existed; fall
  // through to null otherwise.
  void enriched;
  return null;
}

function buildFixIntentText(
  alert: EnrichedAlert,
  additionalContext: string,
): string | null {
  const suffix = additionalContext ? ` ${additionalContext}` : '';

  if (alert.type === 'clarification-needed') {
    const intentText = alert.intentText ?? '<original intent unavailable>';
    return `Fix the following issue with intent "${intentText}": ${alert.description}.${suffix}`.trim();
  }

  if (alert.type === 'maintenance-stuck') {
    const action = alert.suggestedAction ?? alert.description;
    const evidence = alert.evidence ?? '';
    const parts = [action];
    if (evidence) parts.push(`Context: ${evidence}`);
    return `${parts.join('. ')}.${suffix}`.trim();
  }

  if (alert.type === 'GOLDEN_PRINCIPLE_BREACH') {
    const file = alert.breachLocation?.file ?? 'the affected file';
    const message = alert.breachMessage ?? alert.description;
    return `Fix golden principle breach in ${file}: ${message}.${suffix}`.trim();
  }

  // Fallback for any future / promotion-pending alerts: use the
  // alert's own description as the intent text.
  return `${alert.description}.${suffix}`.trim();
}
