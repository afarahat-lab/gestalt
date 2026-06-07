/**
 * Feature routes (migration 024 — planning layer).
 *
 * POST /features         — submit a new feature (kicks off planning:start)
 * GET  /features         — list features (per project or across user's
 *                          memberships)
 * GET  /features/:id     — feature detail (phases + plan log)
 *
 * Every write checks project membership the same way the intents
 * routes do. The orchestrator queue dispatch is fire-and-forget; the
 * response carries the persisted feature row so the CLI can echo it.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, dispatch, loadConfig, createContextLogger,
  emitLiveEvent,
} from '@gestalt/core';
import type { TaskMessage } from '@gestalt/core';
import { requireRole, checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:features' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitFeatureBody {
  title: string;
  description: string;
  projectId: string;
}

interface ListFeaturesQuery {
  projectId?: string;
}

export async function registerFeatureRoutes(app: FastifyInstance): Promise<void> {

  // POST /features — submit a new feature
  app.post<{ Body: SubmitFeatureBody }>(
    '/features',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { title, description, projectId } = request.body;

      if (!title?.trim()) {
        return reply.code(400).send({ error: 'title is required' });
      }
      if (!description?.trim()) {
        return reply.code(400).send({ error: 'description is required' });
      }
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }
      const trimmedProjectId = projectId.trim();
      if (!UUID_RE.test(trimmedProjectId)) {
        return reply.code(400).send({
          error: 'INVALID_PROJECT_ID',
          message: 'projectId must be a UUID',
        });
      }

      const { projects: projectRepo, features } = getRepositories();
      const project = await projectRepo.findById(trimmedProjectId);
      if (!project) {
        return reply.code(404).send({
          error: 'PROJECT_NOT_FOUND',
          message: `No project found with id ${trimmedProjectId}`,
        });
      }
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, trimmedProjectId, 'editor')) return;

      const correlationId = crypto.randomUUID();
      const feature = await features.create({
        id: crypto.randomUUID(),
        projectId: trimmedProjectId,
        title: title.trim(),
        description: description.trim(),
        createdBy: request.user.id,
      });
      log.info({ featureId: feature.id, correlationId }, 'Feature created');

      // Dispatch planning:start to the planning queue. The orchestrator
      // takes it from here — clone, architecture-agent, planner-agent,
      // PLAN.md, first-phase dispatch.
      const message: TaskMessage = {
        id: crypto.randomUUID(),
        correlationId,
        type: 'planning:start',
        sourceAgent: 'orchestrator',
        targetAgent: 'planner-agent',
        priority: 'normal',
        payload: { featureId: feature.id },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      const config = loadConfig();
      await dispatch(message, config.queue);
      emitLiveEvent('intent.created', correlationId, {
        featureId: feature.id, title: feature.title,
      });

      return reply.code(201).send({ data: feature });
    },
  );

  // GET /features — list features for a project (or platform-wide for admin)
  app.get<{ Querystring: ListFeaturesQuery }>(
    '/features',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { features, memberships, platformGroups } = getRepositories();
      const projectId = request.query.projectId?.trim() ?? '';

      if (projectId) {
        if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId)) return;
        const records = await features.listByProject(projectId);
        return reply.send({ data: records, total: records.length });
      }

      // No projectId — flatten across the user's accessible projects.
      let projectIds: string[];
      if (request.user.role === 'platform-admin') {
        const { projects: projectRepo } = getRepositories();
        const all = await projectRepo.listAll();
        projectIds = all.map((p) => p.id);
      } else {
        const [direct, viaGroups] = await Promise.all([
          memberships.findByUser(request.user.id),
          platformGroups.getEffectiveMemberships(request.user.id),
        ]);
        projectIds = Array.from(new Set([
          ...direct.map((m) => m.projectId),
          ...viaGroups.map((m) => m.projectId),
        ]));
      }

      if (projectIds.length === 0) {
        return reply.send({ data: [], total: 0 });
      }
      const records = (await Promise.all(
        projectIds.map((id) => features.listByProject(id)),
      )).flat();
      records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return reply.send({ data: records, total: records.length });
    },
  );

  // GET /features/:id — feature detail including phases + plan log
  app.get<{ Params: { id: string } }>(
    '/features/:id',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { features } = getRepositories();
      const feature = await features.findById(request.params.id);
      if (!feature) {
        return reply.code(404).send({ error: 'Feature not found' });
      }
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, feature.projectId)) return;

      const [phases, planLog] = await Promise.all([
        features.listPhases(feature.id),
        features.listLog(feature.id),
      ]);
      return reply.send({ data: { ...feature, phases, planLog } });
    },
  );
}
