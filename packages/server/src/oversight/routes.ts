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
import { requireRole, checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:oversight' });

interface ListAlertsQuery {
  acknowledged?: string;  // 'true' | 'false' — defaults to unacknowledged-only
  severity?: string;
  projectId?: string;
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
  //
  // Membership rules (matches the read-side pattern of /intents):
  //   - With ?projectId=…  → reader+ on that project; the result set
  //     is then filtered to alerts whose intent belongs to the
  //     project (alerts with no resolvable intent — none today —
  //     would be dropped). Closes the dashboard's prior
  //     client-side-only filter, which let any authenticated user
  //     query /alerts and see every project's alerts
  //   - Without projectId  → platform-admin sees every unack alert;
  //     regular users get an empty array (same shape as /intents
  //     without projectId — never leak project ids via error vs
  //     empty)
  app.get<{ Querystring: ListAlertsQuery }>('/alerts', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
    const { alerts, intents } = getRepositories();
    const projectId = request.query.projectId?.trim();

    if (projectId) {
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId)) return;
    } else if (request.user.role !== 'platform-admin') {
      return reply.send({ data: [], total: 0 });
    }

    const showAcknowledged = request.query.acknowledged === 'true';
    const all = showAcknowledged
      ? []  // intentional: today the dashboard only consumes unacknowledged;
            // the wire shape leaves room to broaden later without a
            // breaking change
      : await alerts.findUnacknowledged();
    const severityFilter = request.query.severity;
    const bySeverity = severityFilter
      ? all.filter((a) => a.severity === severityFilter)
      : all;

    // When projectId is provided, intersect alerts with the project's
    // intents via correlationId. The set is small in practice (one
    // project's open alerts), so a per-alert intent lookup is fine.
    let filtered = bySeverity;
    if (projectId) {
      const matched: typeof bySeverity = [];
      for (const a of bySeverity) {
        const intent = await intents.findByCorrelationId(a.correlationId);
        if (intent?.projectId === projectId) matched.push(a);
      }
      filtered = matched;
    }

    const enriched = await Promise.all(filtered.map(enrichAlert));
    return reply.send({ data: enriched, total: enriched.length });
  });

  // GET /alerts/:id — single alert. Membership check via correlationId
  // → intent → projectId (same prevention-of-enumeration rule as
  // /intents/:id: a non-member gets 403, not 404).
  app.get<{ Params: { id: string } }>('/alerts/:id', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
    const { alerts, intents } = getRepositories();
    const alert = await alerts.findById(request.params.id);
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    const intent = await intents.findByCorrelationId(alert.correlationId);
    if (intent) {
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId)) return;
    }
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
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'editor')) return;

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

  // POST /alerts/:id/pipeline-feedback — pipeline failure resume flow.
  // The operator's feedback is persisted to the same intent's
  // `clarification` column and the cycle re-dispatches on the SAME
  // branch + PR. pr-agent on the retry leg pushes the fix commit to
  // the existing branch and skips `createPullRequest`. This is
  // distinct from `/fix-intent` (which creates a NEW intent + a fresh
  // branch); pipeline-feedback re-uses the failing intent so the
  // existing PR + CI run history stays intact.
  app.post<{ Params: { id: string }; Body: { feedback?: unknown } }>(
    '/alerts/:id/pipeline-feedback',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
      if (!feedback) {
        return reply.code(400).send({
          error: 'feedback is required (describe what failed and how to fix it)',
          code: 'INVALID_FEEDBACK',
        });
      }

      const { alerts, intents, audit } = getRepositories();
      const existing = await alerts.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Alert not found' });
      if (existing.acknowledgedAt) {
        return reply.code(409).send({ error: 'Alert already acknowledged' });
      }
      if (existing.type !== 'pipeline-failed' && existing.type !== 'pipeline-timeout') {
        return reply.code(400).send({
          error: `Alert type '${existing.type}' does not accept pipeline-feedback`,
          code: 'INVALID_ALERT_TYPE',
        });
      }

      // Read intentId out of the context (pipeline-agent puts it
      // there) and load the intent — we need its projectId + the
      // persisted branch coordinates pr-agent saved.
      const ctx = existing.context ?? {};
      const intentId = typeof ctx['intentId'] === 'string' ? (ctx['intentId'] as string) : null;
      if (!intentId) {
        return reply.code(400).send({
          error: 'Alert has no intentId in context — cannot resume',
          code: 'INVALID_ALERT_CONTEXT',
        });
      }
      const intent = await intents.findById(intentId);
      if (!intent) return reply.code(404).send({ error: 'Intent not found' });

      // Editor minimum — the resume cycle will commit code on the
      // project's repo. Mirrors the fix-intent route's check.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId, 'editor')) return;

      // Persist the feedback to intents.clarification so the generate
      // orchestrator reads it on every dispatch (including any
      // subsequent gate-retry legs) — same survives-the-payload
      // guarantee migration 006 introduced for vague-intent
      // clarification.
      await intents.saveClarification(intent.id, feedback);

      // Build the resume dispatch. `source: 'pipeline-feedback'`
      // routes the intent-agent prompt to the CI-failure framing.
      // `resumeOnBranch` + `prNumber` + `prUrl` are read off the
      // intent row (pr-agent persisted them on the original cycle).
      const config = loadConfig();
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId: intent.correlationId,
        type: 'generate:intent',
        sourceAgent: 'orchestrator',
        targetAgent: 'intent-agent',
        priority: 'normal' as TaskPriority,
        payload: {
          intentId: intent.id,
          projectId: intent.projectId,
          text: intent.text,
          clarification: feedback,
          source: 'pipeline-feedback',
          resumeOnBranch: intent.branchName ?? undefined,
          prNumber: intent.prNumber ?? undefined,
          prUrl: intent.prUrl ?? undefined,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      await dispatch(message, config.queue);
      await intents.updateStatus(intent.id, 'generating');

      const ack = await alerts.acknowledge(existing.id, request.user.id);

      await audit.append({
        actor: request.user.id,
        action: 'alert.pipeline-feedback-submitted',
        entityType: 'alerts',
        entityId: ack.id,
        correlationId: intent.correlationId,
        metadata: {
          type: ack.type,
          intentId: intent.id,
          feedbackLength: feedback.length,
          branch: intent.branchName,
          prNumber: intent.prNumber,
          ip: request.ip,
        },
      });

      emitLiveEvent('intent.status-changed', intent.correlationId, {
        intentId: intent.id, status: 'generating',
      });
      emitLiveEvent('alert.acknowledged', ack.correlationId, { alertId: ack.id });
      log.info(
        { alertId: ack.id, intentId: intent.id, branch: intent.branchName, prNumber: intent.prNumber },
        'Pipeline feedback submitted — resuming cycle on existing branch',
      );

      return reply.send({
        data: {
          intentId: intent.id,
          status: 'generating',
          branch: intent.branchName,
          prNumber: intent.prNumber,
          prUrl: intent.prUrl,
        },
      });
    },
  );

  // POST /alerts/:id/resume — generic human-feedback resume for any
  // failure alert type (migration 020). The operator's feedback is
  // saved to `intents.last_resume_context` (autoHealed: false) and
  // the cycle re-dispatches on the SAME branch + PR. Distinct from
  // `pipeline-feedback`: pipeline-feedback handles pipeline-failed
  // / pipeline-timeout specifically and persists to
  // `intents.clarification`. `resume` is the generic equivalent for
  // generate-error / gate-max-retries / deploy-error / maintenance-
  // error / custom-agent-failure escalations.
  app.post<{ Params: { id: string }; Body: { feedback?: unknown } }>(
    '/alerts/:id/resume',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
      if (!feedback) {
        return reply.code(400).send({
          error: 'feedback is required (describe what went wrong and how to fix it)',
          code: 'INVALID_FEEDBACK',
        });
      }

      const { alerts, intents, signals, audit } = getRepositories();
      const existing = await alerts.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Alert not found' });
      if (existing.acknowledgedAt) {
        return reply.code(409).send({ error: 'Alert already acknowledged' });
      }
      // Reject types that have their own dedicated resume flow.
      // pipeline-failed / pipeline-timeout → POST /alerts/:id/pipeline-feedback
      // clarification-needed → POST /intents/:id/clarify
      // GOLDEN_PRINCIPLE_BREACH → POST /interventions
      const failureTypes = new Set<string>([
        'generate-error', 'gate-max-retries', 'deploy-error',
        'maintenance-error', 'custom-agent-failure',
        // pipeline-* accepted too — the operator may prefer the
        // generic resume path if the alert was created by the
        // self-healing loop (which carries the same shape).
        'pipeline-failed', 'pipeline-timeout',
      ]);
      if (!failureTypes.has(existing.type)) {
        return reply.code(400).send({
          error: `Alert type '${existing.type}' does not accept generic resume — use the type-specific endpoint`,
          code: 'INVALID_ALERT_TYPE',
        });
      }

      const ctx = existing.context ?? {};
      const intentId = typeof ctx['intentId'] === 'string' ? (ctx['intentId'] as string) : null;
      if (!intentId) {
        return reply.code(400).send({
          error: 'Alert has no intentId in context — cannot resume',
          code: 'INVALID_ALERT_CONTEXT',
        });
      }
      const intent = await intents.findById(intentId);
      if (!intent) return reply.code(404).send({ error: 'Intent not found' });

      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId, 'editor')) return;

      // Build a ResumeContext (autoHealed: false — operator-driven).
      // priorSignals carries the cycle's outstanding signals so the
      // next intent-agent sees what was tried.
      const cycleSignals = await signals.findByCorrelationId(intent.correlationId);
      const failureType = typeof ctx['failureType'] === 'string' ? (ctx['failureType'] as string) : existing.type;
      const failureSummary = typeof ctx['escalationReason'] === 'string'
        ? (ctx['escalationReason'] as string)
        : existing.description;

      await intents.saveResumeContext(intent.id, {
        operatorFeedback: feedback,
        failureType,
        failureSummary,
        priorSignals: cycleSignals.map((s) => ({
          type: s.type, message: s.message,
          sourceAgent: s.sourceAgent, severity: s.severity,
        })),
        priorArtifactPaths: [],
        attemptNumber: (intent.attemptCount ?? 0) + 1,
        feedbackProvidedAt: new Date().toISOString(),
        autoHealed: false,
      });
      await intents.incrementAttemptCount(intent.id);

      const config = loadConfig();
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId: intent.correlationId,
        type: 'generate:intent',
        sourceAgent: 'orchestrator',
        targetAgent: 'intent-agent',
        priority: 'normal' as TaskPriority,
        payload: {
          intentId: intent.id,
          projectId: intent.projectId,
          text: intent.text,
          clarification: feedback,
          source: 'operator-resume',
          resumeOnBranch: intent.branchName ?? undefined,
          prNumber: intent.prNumber ?? undefined,
          prUrl: intent.prUrl ?? undefined,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      await dispatch(message, config.queue);
      await intents.updateStatus(intent.id, 'generating');

      const ack = await alerts.acknowledge(existing.id, request.user.id);

      await audit.append({
        actor: request.user.id,
        action: 'alert.resume-submitted',
        entityType: 'alerts',
        entityId: ack.id,
        correlationId: intent.correlationId,
        metadata: {
          type: ack.type,
          intentId: intent.id,
          feedbackLength: feedback.length,
          branch: intent.branchName,
          prNumber: intent.prNumber,
          ip: request.ip,
        },
      });

      emitLiveEvent('intent.status-changed', intent.correlationId, {
        intentId: intent.id, status: 'generating',
      });
      emitLiveEvent('alert.acknowledged', ack.correlationId, { alertId: ack.id });
      log.info(
        { alertId: ack.id, intentId: intent.id, alertType: ack.type, branch: intent.branchName },
        'Operator resume submitted — cycle re-dispatched',
      );

      return reply.send({
        data: {
          intentId: intent.id,
          status: 'generating',
          branch: intent.branchName,
          prNumber: intent.prNumber,
          prUrl: intent.prUrl,
        },
      });
    },
  );

  // POST /interventions lives in routes/interventions.ts now (ADR-021,
  // migration 011). The earlier 501 stub used to point operators at the
  // clarification endpoint; that flow is still right for vague intents,
  // but the four typed actions for GP_BREACH escalation have their own
  // route now.
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
