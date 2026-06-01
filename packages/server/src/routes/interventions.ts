/**
 * Intervention routes (ADR-021).
 *
 *   POST /interventions
 *       Body: { intentId, action, notes? }
 *       Four typed actions — see `InterventionAction` in core:
 *         resume                — false positive, dispatch deploy chain
 *         abort                 — real breach, transition to failed
 *         acknowledge-breach    — record + notes (required), → failed
 *         request-clarification — pause as waiting-for-clarification
 *
 *   GET  /interventions?intentId=<id>
 *       Returns the operator's intervention history for one intent.
 *
 * Constraints (enforced here):
 *   - Intent must be in `escalated` status — anything else returns 409
 *     `INVALID_INTENT_STATUS`. Operators cannot intervene on a cycle
 *     that hasn't paused
 *   - editor+ on the intent's project — handler-level membership check
 *     (the projectId is on the intent record, not in the URL)
 *   - `acknowledge-breach` requires non-empty notes — 400
 *   - GP_BREACH signals are resolved by literal `'human'` per the
 *     existing repo-level guard; the actor's user id goes on the
 *     intervention + audit row
 *   - GP-002: every action writes an audit row. GP-006: the audit
 *     records only `notesLength`, never the note content
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, dispatch, loadConfig, createContextLogger,
  type TaskMessage, type TaskPriority, type InterventionAction,
} from '@gestalt/core';
import { emitLiveEvent } from '../events';
import { requireRole, checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:interventions' });

const VALID_ACTIONS: readonly InterventionAction[] = [
  'resume', 'abort', 'acknowledge-breach', 'request-clarification',
];

interface SubmitBody {
  intentId: string;
  action: InterventionAction;
  notes?: string;
}

interface ListQuery {
  intentId?: string;
}

export async function registerInterventionRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Querystring: ListQuery }>(
    '/interventions',
    { preHandler: requireRole('viewer') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const intentId = request.query.intentId?.trim();
      if (!intentId) {
        return reply.code(400).send({ error: 'intentId is required' });
      }
      const { interventions, intents } = getRepositories();
      // Resolve the intent so we can enforce project membership. An
      // unknown intentId returns an empty array (consistent with the
      // "never leak via 404 vs empty" rule used elsewhere in the
      // read layer).
      const intent = await intents.findById(intentId);
      if (!intent) return reply.send({ data: [] });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId)) return;
      const rows = await interventions.findByIntentId(intentId);
      return reply.send({ data: rows });
    },
  );

  app.post<{ Body: SubmitBody }>(
    '/interventions',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      const body = request.body ?? ({} as SubmitBody);
      const { intentId, action } = body;
      const notes = body.notes?.trim();

      if (!intentId?.trim()) {
        return reply.code(400).send({ error: 'intentId is required' });
      }
      if (!action || !VALID_ACTIONS.includes(action)) {
        return reply.code(400).send({
          error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
        });
      }
      if (action === 'acknowledge-breach' && (!notes || notes.length === 0)) {
        return reply.code(400).send({
          error: 'notes are required for acknowledge-breach',
        });
      }

      const repos = getRepositories();
      const intent = await repos.intents.findById(intentId);
      if (!intent) return reply.code(404).send({ error: 'Intent not found' });

      if (intent.status !== 'escalated') {
        return reply.code(409).send({
          error: `Intent is not in escalated status (current: '${intent.status}')`,
          code: 'INVALID_INTENT_STATUS',
        });
      }

      // Membership check — the projectId is on the intent, not in the URL.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId, 'editor')) return;

      // Resolve the GP_BREACH signal + alert for this cycle. There can
      // be more than one breach signal — operators address them as a
      // group. We mark the first one resolved (the repo's guard runs
      // per-id) and attach the alert id to the intervention row when
      // present.
      const [signals, allAlerts] = await Promise.all([
        repos.signals.findByCorrelationId(intent.correlationId),
        repos.alerts.findByCorrelationId(intent.correlationId),
      ]);
      const breachSignals = signals.filter((s) => s.type === 'GOLDEN_PRINCIPLE_BREACH');
      const breachAlert = allAlerts.find(
        (a) => a.type === 'GOLDEN_PRINCIPLE_BREACH' && a.acknowledgedAt === null,
      ) ?? null;
      const signalId = breachSignals[0]?.id ?? null;

      // Common scaffolding shared by every action — the intervention
      // row is the canonical record of the operator's decision.
      const createIntervention = (): Promise<unknown> =>
        repos.interventions.create({
          correlationId: intent.correlationId,
          intentId: intent.id,
          alertId: breachAlert?.id ?? null,
          action,
          actorId: request.user!.id,
          notes: notes && notes.length > 0 ? notes : null,
        });

      try {
        switch (action) {
          // ── resume ──────────────────────────────────────────────────
          case 'resume': {
            // GP_BREACH signals are resolved by literal 'human' per the
            // repo guard; the actor's id lives on the intervention row.
            if (signalId) {
              await repos.signals.markResolved(signalId, 'human');
            }
            if (breachAlert) {
              await repos.alerts.acknowledge(breachAlert.id, request.user.id);
            }
            await createIntervention();
            await repos.audit.append({
              actor: request.user.id,
              action: 'intervention.resume',
              entityType: 'intent',
              entityId: intent.id,
              correlationId: intent.correlationId,
              metadata: { signalId, alertId: breachAlert?.id ?? null, ip: request.ip },
            });

            // Dispatch deploy:pr with the artifact set from the generate
            // cycle — same shape the gate orchestrator uses on `pass`.
            const artifacts = await repos.artifacts.findByCorrelationId(intent.correlationId);
            const config = loadConfig();
            const message: TaskMessage = {
              id: crypto.randomUUID(),
              correlationId: intent.correlationId,
              type: 'deploy:pr',
              sourceAgent: 'review-agent',
              targetAgent: 'pr-agent',
              priority: 'normal' as TaskPriority,
              payload: {
                intentId: intent.id,
                projectId: intent.projectId,
                intentText: intent.text,
                artifacts: artifacts.map((a) => ({
                  id: a.id, type: a.type, path: a.path, content: a.content,
                })),
              },
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            };
            await dispatch(message, config.queue);

            await repos.intents.updateStatus(intent.id, 'deploying');
            emitLiveEvent('intent.status-changed', intent.correlationId, {
              intentId: intent.id,
              status: 'deploying',
              intervention: { action: 'resume', actor: request.user.id },
            });
            if (breachAlert) {
              emitLiveEvent('alert.acknowledged', intent.correlationId, { alertId: breachAlert.id });
            }
            log.info(
              { intentId: intent.id, actor: request.user.id, artifactCount: artifacts.length },
              'Intervention resume — deploy:pr dispatched',
            );
            return reply.send({
              data: { action: 'resume', intentId: intent.id, status: 'deploying' },
            });
          }

          // ── abort ───────────────────────────────────────────────────
          case 'abort': {
            if (breachAlert) {
              await repos.alerts.acknowledge(breachAlert.id, request.user.id);
            }
            await createIntervention();
            await repos.audit.append({
              actor: request.user.id,
              action: 'intervention.abort',
              entityType: 'intent',
              entityId: intent.id,
              correlationId: intent.correlationId,
              metadata: { alertId: breachAlert?.id ?? null, ip: request.ip },
            });
            await repos.intents.updateStatus(intent.id, 'failed');
            emitLiveEvent('intent.status-changed', intent.correlationId, {
              intentId: intent.id,
              status: 'failed',
              intervention: { action: 'abort', actor: request.user.id },
            });
            if (breachAlert) {
              emitLiveEvent('alert.acknowledged', intent.correlationId, { alertId: breachAlert.id });
            }
            log.info({ intentId: intent.id, actor: request.user.id }, 'Intervention abort');
            return reply.send({
              data: { action: 'abort', intentId: intent.id, status: 'failed' },
            });
          }

          // ── acknowledge-breach ──────────────────────────────────────
          case 'acknowledge-breach': {
            if (signalId) {
              await repos.signals.markResolved(signalId, 'human');
            }
            if (breachAlert) {
              await repos.alerts.acknowledge(breachAlert.id, request.user.id);
            }
            await createIntervention();
            await repos.audit.append({
              actor: request.user.id,
              action: 'intervention.acknowledge-breach',
              entityType: 'intent',
              entityId: intent.id,
              correlationId: intent.correlationId,
              metadata: {
                // GP-006: store only the length. The text lives on
                // interventions.notes for forensic recall.
                notesLength: notes!.length,
                signalId,
                alertId: breachAlert?.id ?? null,
                ip: request.ip,
              },
            });
            await repos.intents.updateStatus(intent.id, 'failed');
            emitLiveEvent('intent.status-changed', intent.correlationId, {
              intentId: intent.id,
              status: 'failed',
              intervention: { action: 'acknowledge-breach', actor: request.user.id },
            });
            if (breachAlert) {
              emitLiveEvent('alert.acknowledged', intent.correlationId, { alertId: breachAlert.id });
            }
            log.info(
              { intentId: intent.id, actor: request.user.id, notesLength: notes!.length },
              'Intervention acknowledge-breach',
            );
            return reply.send({
              data: { action: 'acknowledge-breach', intentId: intent.id, status: 'failed' },
            });
          }

          // ── request-clarification ───────────────────────────────────
          case 'request-clarification': {
            await createIntervention();
            const newAlert = await repos.alerts.create({
              correlationId: intent.correlationId,
              intentId: intent.id,
              type: 'clarification-needed',
              severity: 'high',
              title: 'Clarification requested for escalated intent',
              description:
                'An operator requested clarification before deciding how to ' +
                'handle this golden principle breach.',
              requiredAction: 'provide-clarification',
              context: {
                intentId: intent.id,
                triggeredBy: 'intervention',
                breachSignalIds: breachSignals.map((s) => s.id),
              },
            });
            await repos.intents.updateStatus(intent.id, 'waiting-for-clarification');
            await repos.audit.append({
              actor: request.user.id,
              action: 'intervention.request-clarification',
              entityType: 'intent',
              entityId: intent.id,
              correlationId: intent.correlationId,
              metadata: {
                alertId: newAlert.id,
                notesLength: notes?.length ?? 0,
                ip: request.ip,
              },
            });
            emitLiveEvent('alert.created', intent.correlationId, {
              alertId: newAlert.id,
              type: 'clarification-needed',
              intentId: intent.id,
            });
            emitLiveEvent('intent.status-changed', intent.correlationId, {
              intentId: intent.id,
              status: 'waiting-for-clarification',
              intervention: { action: 'request-clarification', actor: request.user.id },
            });
            log.info(
              { intentId: intent.id, actor: request.user.id, newAlertId: newAlert.id },
              'Intervention request-clarification',
            );
            return reply.send({
              data: {
                action: 'request-clarification',
                intentId: intent.id,
                status: 'waiting-for-clarification',
              },
            });
          }
        }
      } catch (err) {
        log.error({ err, intentId, action }, 'Intervention failed');
        return reply.code(500).send({
          error: 'Intervention failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
