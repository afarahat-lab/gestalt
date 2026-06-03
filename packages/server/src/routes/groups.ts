/**
 * Platform groups routes (Brief 1 — bulk user management, migration 018).
 *
 * All routes require platform-admin. A group bundles users (members)
 * and project-role assignments; membership in the group implies
 * implicit access to every project the group is assigned to. The
 * auth middleware (`requireProjectMembership`) merges this with the
 * user's direct `project_memberships` rows by `max(roleRank)`.
 *
 *   GET    /platform/groups
 *   POST   /platform/groups
 *   PATCH  /platform/groups/:id
 *   DELETE /platform/groups/:id
 *
 *   GET    /platform/groups/:id/members
 *   POST   /platform/groups/:id/members
 *   DELETE /platform/groups/:id/members/:userId
 *
 *   GET    /platform/groups/:id/projects
 *   POST   /platform/groups/:id/projects
 *   DELETE /platform/groups/:id/projects/:projectId
 *
 * All mutations write an audit row.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:groups' });

const VALID_PROJECT_ROLES = new Set(['project-admin', 'editor', 'reader']);

interface CreateBody { name?: unknown; description?: unknown; }
interface PatchBody { name?: unknown; description?: unknown; }
interface AddMemberBody { userId?: unknown; }
interface AssignProjectBody { projectId?: unknown; role?: unknown; }

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {

  // ─── Groups CRUD ──────────────────────────────────────────────────────────

  app.get(
    '/platform/groups',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const records = await getRepositories().platformGroups.list();
      return reply.send({ data: records });
    },
  );

  app.post<{ Body: CreateBody }>(
    '/platform/groups',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return reply.code(400).send({ error: 'name is required', code: 'INVALID_NAME' });
      }
      if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
        return reply.code(400).send({ error: 'description must be a string or null', code: 'INVALID_DESCRIPTION' });
      }
      const { platformGroups, audit } = getRepositories();
      const clash = await platformGroups.findByName(body.name.trim());
      if (clash) {
        return reply.code(409).send({
          error: `Group with name '${body.name.trim()}' already exists`,
          code: 'NAME_TAKEN',
        });
      }
      const created = await platformGroups.create({
        name: body.name.trim(),
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        createdBy: request.user.id,
      });
      await audit.append({
        actor: request.user.id,
        action: 'platform.group-added',
        entityType: 'platform_groups',
        entityId: created.id,
        correlationId: request.correlationId,
        metadata: { name: created.name, ip: request.ip },
      });
      log.info({ id: created.id, name: created.name }, 'Platform group created');
      return reply.code(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/platform/groups/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const updates: { name?: string; description?: string | null } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
          return reply.code(400).send({ error: 'name must be a non-empty string', code: 'INVALID_NAME' });
        }
        updates.name = body.name.trim();
      }
      if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== 'string') {
          return reply.code(400).send({ error: 'description must be a string or null', code: 'INVALID_DESCRIPTION' });
        }
        updates.description = body.description as string | null;
      }
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'No fields to update', code: 'EMPTY_PATCH' });
      }

      const { platformGroups, audit } = getRepositories();
      const existing = await platformGroups.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Group not found' });

      // Rename collision
      if (updates.name && updates.name !== existing.name) {
        const clash = await platformGroups.findByName(updates.name);
        if (clash) {
          return reply.code(409).send({
            error: `Group with name '${updates.name}' already exists`,
            code: 'NAME_TAKEN',
          });
        }
      }

      const updated = await platformGroups.update(request.params.id, updates);
      await audit.append({
        actor: request.user.id,
        action: 'platform.group-updated',
        entityType: 'platform_groups',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: {
          changedFields: Object.keys(updates),
          previousName: existing.name,
          newName: updated.name,
          ip: request.ip,
        },
      });
      return reply.send({ data: updated });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/platform/groups/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformGroups, audit } = getRepositories();
      const existing = await platformGroups.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Group not found' });

      // CASCADE handles both group_memberships AND
      // group_project_assignments. Direct project_memberships are
      // NEVER touched — only group-derived access disappears.
      await platformGroups.delete(existing.id);

      await audit.append({
        actor: request.user.id,
        action: 'platform.group-deleted',
        entityType: 'platform_groups',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: { name: existing.name, ip: request.ip },
      });
      log.info({ id: existing.id, name: existing.name }, 'Platform group deleted');
      return reply.code(204).send();
    },
  );

  // ─── Members ──────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/platform/groups/:id/members',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformGroups } = getRepositories();
      const exists = await platformGroups.findById(request.params.id);
      if (!exists) return reply.code(404).send({ error: 'Group not found' });
      const members = await platformGroups.listMembers(request.params.id);
      return reply.send({ data: members });
    },
  );

  app.post<{ Params: { id: string }; Body: AddMemberBody }>(
    '/platform/groups/:id/members',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      if (typeof body.userId !== 'string' || !body.userId.trim()) {
        return reply.code(400).send({ error: 'userId is required', code: 'INVALID_USER_ID' });
      }
      const { platformGroups, users, audit } = getRepositories();
      const group = await platformGroups.findById(request.params.id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });
      const user = await users.findById(body.userId.trim());
      if (!user) return reply.code(404).send({ error: 'User not found' });

      await platformGroups.addMember(group.id, user.id, request.user.id);
      await audit.append({
        actor: request.user.id,
        action: 'platform.group-member-added',
        entityType: 'platform_groups',
        entityId: group.id,
        correlationId: request.correlationId,
        metadata: { groupName: group.name, userEmail: user.email, ip: request.ip },
      });
      log.info({ groupId: group.id, userId: user.id }, 'Group member added');
      return reply.code(201).send({ data: { groupId: group.id, userId: user.id } });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/platform/groups/:id/members/:userId',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformGroups, users, audit } = getRepositories();
      const group = await platformGroups.findById(request.params.id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });

      const user = await users.findById(request.params.userId);
      await platformGroups.removeMember(group.id, request.params.userId);
      await audit.append({
        actor: request.user.id,
        action: 'platform.group-member-removed',
        entityType: 'platform_groups',
        entityId: group.id,
        correlationId: request.correlationId,
        metadata: {
          groupName: group.name,
          userEmail: user?.email ?? null,
          userId: request.params.userId,
          ip: request.ip,
        },
      });
      return reply.code(204).send();
    },
  );

  // ─── Project assignments ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/platform/groups/:id/projects',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformGroups } = getRepositories();
      const exists = await platformGroups.findById(request.params.id);
      if (!exists) return reply.code(404).send({ error: 'Group not found' });
      const assignments = await platformGroups.listProjectAssignments(request.params.id);
      return reply.send({ data: assignments });
    },
  );

  app.post<{ Params: { id: string }; Body: AssignProjectBody }>(
    '/platform/groups/:id/projects',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      if (typeof body.projectId !== 'string' || !body.projectId.trim()) {
        return reply.code(400).send({ error: 'projectId is required', code: 'INVALID_PROJECT_ID' });
      }
      if (typeof body.role !== 'string' || !VALID_PROJECT_ROLES.has(body.role)) {
        return reply.code(400).send({
          error: `role must be one of: ${[...VALID_PROJECT_ROLES].join(', ')}`,
          code: 'INVALID_ROLE',
        });
      }
      const { platformGroups, projects, audit } = getRepositories();
      const group = await platformGroups.findById(request.params.id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });
      const project = await projects.findById(body.projectId.trim());
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const role = body.role as 'project-admin' | 'editor' | 'reader';
      await platformGroups.assignToProject(group.id, project.id, role, request.user.id);

      await audit.append({
        actor: request.user.id,
        action: 'platform.group-project-assigned',
        entityType: 'platform_groups',
        entityId: group.id,
        correlationId: request.correlationId,
        metadata: {
          groupName: group.name,
          projectName: project.name,
          role,
          ip: request.ip,
        },
      });
      log.info({ groupId: group.id, projectId: project.id, role }, 'Group project assignment set');
      return reply.code(201).send({
        data: { groupId: group.id, projectId: project.id, role },
      });
    },
  );

  app.delete<{ Params: { id: string; projectId: string } }>(
    '/platform/groups/:id/projects/:projectId',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformGroups, projects, audit } = getRepositories();
      const group = await platformGroups.findById(request.params.id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });

      const project = await projects.findById(request.params.projectId);
      await platformGroups.removeFromProject(group.id, request.params.projectId);

      await audit.append({
        actor: request.user.id,
        action: 'platform.group-project-removed',
        entityType: 'platform_groups',
        entityId: group.id,
        correlationId: request.correlationId,
        metadata: {
          groupName: group.name,
          projectName: project?.name ?? null,
          projectId: request.params.projectId,
          ip: request.ip,
        },
      });
      return reply.code(204).send();
    },
  );
}
