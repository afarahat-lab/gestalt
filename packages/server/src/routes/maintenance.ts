/**
 * Maintenance routes.
 *
 *   GET  /maintenance/runs?projectId&agentRole&limit   — list past runs
 *   POST /maintenance/trigger                          — run an agent now
 *
 * Reads from the `maintenance_runs` table populated by the scheduler.
 * The manual-trigger endpoint reuses the same runner the cron callbacks
 * use, so the observability story is identical (agent_executions-style
 * row, SSE event, intent dispatch via the generate queue).
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, loadConfig, createContextLogger,
} from '@gestalt/core';
import { triggerMaintenanceRun } from '@gestalt/agents-maintenance';
import type { MaintenanceAgentName } from '@gestalt/agents-maintenance';
import { requireRole, checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:maintenance' });

const VALID_AGENT_NAMES: MaintenanceAgentName[] = [
  'drift-agent', 'alignment-agent', 'gc-agent', 'evaluation-agent',
];

interface ListQuery {
  projectId?: string;
  agentRole?: string;
  limit?: string;
}

interface TriggerBody {
  agentRole?: string;
  projectId?: string;
}

export async function registerMaintenanceRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Querystring: ListQuery }>(
    '/maintenance/runs',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { maintenanceRuns } = getRepositories();
      if (request.query.projectId) {
        if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.query.projectId)) return;
      }
      const limit = Math.min(
        Math.max(1, parseInt(request.query.limit ?? '20', 10) || 20),
        200,
      );
      const records = await maintenanceRuns.list({
        ...(request.query.projectId ? { projectId: request.query.projectId } : {}),
        ...(request.query.agentRole ? { agentRole: request.query.agentRole } : {}),
        limit,
      });
      return reply.send({ data: records });
    },
  );

  app.post<{ Body: TriggerBody }>(
    '/maintenance/trigger',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      const body = request.body ?? {};
      const agentRole = body.agentRole as MaintenanceAgentName | undefined;
      const projectId = body.projectId;

      if (!agentRole || !VALID_AGENT_NAMES.includes(agentRole)) {
        return reply.code(400).send({
          error: `agentRole must be one of: ${VALID_AGENT_NAMES.join(', ')}`,
        });
      }
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }

      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      // projectId is in the body, so `requireRole('operator')` can't
      // check membership for us — do it here. Editor is the minimum:
      // readers shouldn't be triggering maintenance work that could
      // queue an intent against the project.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'editor')) return;

      const { projects } = getRepositories();
      const project = await projects.findById(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      log.info(
        { agentRole, projectId, actor: request.user?.id },
        'Manual maintenance trigger',
      );

      const config = loadConfig();
      const record = await triggerMaintenanceRun({
        agentName: agentRole,
        config: { queueConfig: config.queue },
        scopedProjectId: projectId,
      });

      return reply.send({ data: record });
    },
  );

  // Operator-only full reset of a project's finding-attempt rows.
  // Intentionally deletes ALL attempts (escalated or not) — this is the
  // "I cleaned up the files manually, give me a fresh budget" button.
  // The audit row carries the project id + reset count but NOT the
  // finding hashes themselves (GP-006: hashes are derived from finding
  // content which may include file paths).
  app.delete<{ Params: { projectId: string } }>(
    '/maintenance/findings/:projectId',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      const { projectId } = request.params;
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }

      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      // Route param is `:projectId` not `:id` so `requireRole('operator')`
      // doesn't resolve membership for us. Same editor-minimum as the
      // trigger above — resetting another project's finding budget is
      // not something a reader of THIS project should be able to do.
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'editor')) return;

      const { projects, findingAttempts, audit } = getRepositories();
      const project = await projects.findById(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      const deleted = await findingAttempts.resetAll(projectId);

      log.info(
        { projectId, deleted, actor: request.user?.id },
        'Maintenance finding attempts reset',
      );

      // GP-006 — the audit record carries the project + the count, not
      // the deleted finding hashes (hashes are derived from finding
      // content which may include file paths).
      await audit.append({
        actor: request.user?.id ?? 'unknown',
        action: 'maintenance.findings-reset',
        entityType: 'project',
        entityId: projectId,
        correlationId: projectId,
        metadata: {
          projectName: project.name,
          deletedCount: deleted,
          ip: request.ip,
        },
      });

      return reply.send({ data: { deleted } });
    },
  );
}
