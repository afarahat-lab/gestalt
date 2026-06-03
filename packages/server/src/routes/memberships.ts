/**
 * Project membership routes (migration 010).
 *
 *   GET    /projects/:id/members           — any project member or platform-admin
 *   POST   /projects/:id/members           — project-admin on project OR platform-admin
 *   PATCH  /projects/:id/members/:userId   — project-admin on project OR platform-admin
 *   DELETE /projects/:id/members/:userId   — project-admin on project OR platform-admin
 *
 * Constraints:
 *   - Cannot remove the last `project-admin` from a project
 *   - All mutations write an audit row (GP-002)
 *
 * The three mutation routes use `checkProjectMembership(...,
 * 'project-admin')` directly instead of the legacy
 * `requireRole('operator')` preHandler. The brief was explicit:
 * EDITORS should not be able to manage members — only project-admins
 * (and platform-admins via the helper's early-return bypass). The
 * GET handler keeps `requireRole('viewer')` so any project member
 * can see who else is on the project.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type ProjectRole, type UserRecord, type ProjectMembershipRecord,
} from '@gestalt/core';
import { requireRole, checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:memberships' });

const VALID_PROJECT_ROLES: readonly ProjectRole[] = ['project-admin', 'editor', 'reader'];

interface AddMemberBody {
  userId: string;
  role: ProjectRole;
}

interface UpdateMemberBody {
  role: ProjectRole;
}

interface MemberSummary {
  userId: string;
  email: string;
  displayName: string;
  platformRole: UserRecord['role'];
  projectRole: ProjectRole;
  deactivatedAt: Date | null;
  assignedBy: string | null;
  createdAt: Date;
}

function toSummary(user: UserRecord, m: ProjectMembershipRecord): MemberSummary {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    platformRole: user.role,
    projectRole: m.role,
    deactivatedAt: user.deactivatedAt,
    assignedBy: m.assignedBy,
    createdAt: m.createdAt,
  };
}

export async function registerMembershipRoutes(app: FastifyInstance): Promise<void> {

  // ── List members ───────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/projects/:id/members',
    { preHandler: requireRole('viewer') },
    async (request, reply) => {
      const projectId = request.params.id;
      const { projects, memberships, users } = getRepositories();

      const project = await projects.findById(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const rows = await memberships.findByProject(projectId);
      const summaries: MemberSummary[] = [];
      for (const m of rows) {
        const user = await users.findById(m.userId);
        if (!user) continue;  // FK cascade should prevent this, but be defensive
        summaries.push(toSummary(user, m));
      }
      return reply.send({ data: summaries });
    },
  );

  // ── Add member ─────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: AddMemberBody }>(
    '/projects/:id/members',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const projectId = request.params.id;
      // project-admin minimum — editors no longer manage members
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'project-admin')) return;
      const body = request.body ?? ({} as AddMemberBody);

      if (!body.userId?.trim() || !body.role) {
        return reply.code(400).send({ error: 'userId and role are required' });
      }
      if (!VALID_PROJECT_ROLES.includes(body.role)) {
        return reply.code(400).send({
          error: `Invalid role '${body.role}'. Valid values: ${VALID_PROJECT_ROLES.join(', ')}`,
        });
      }

      const { projects, users, memberships, audit } = getRepositories();
      const project = await projects.findById(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const target = await users.findById(body.userId);
      if (!target) return reply.code(404).send({ error: 'User not found' });

      const existing = await memberships.findMembership(target.id, projectId);
      const previousRole = existing?.role ?? null;
      const record = await memberships.addMember({
        userId: target.id,
        projectId,
        role: body.role,
        assignedBy: request.user.id,
      });

      await audit.append({
        actor: request.user.id,
        action: previousRole ? 'project.member-role-updated' : 'project.member-added',
        entityType: 'project_memberships',
        entityId: record.id,
        correlationId: request.correlationId,
        metadata: {
          projectId,
          targetUserId: target.id,
          targetEmail: target.email,
          previousRole,
          newRole: body.role,
          ip: request.ip,
        },
      });

      log.info(
        { projectId, userId: target.id, role: body.role, previousRole },
        'Member added/updated',
      );
      return reply.code(previousRole ? 200 : 201).send({ data: record });
    },
  );

  // ── Update member role ─────────────────────────────────────────────────────

  app.patch<{ Params: { id: string; userId: string }; Body: UpdateMemberBody }>(
    '/projects/:id/members/:userId',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { id: projectId, userId } = request.params;
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'project-admin')) return;
      const body = request.body ?? ({} as UpdateMemberBody);

      if (!VALID_PROJECT_ROLES.includes(body.role)) {
        return reply.code(400).send({
          error: `Invalid role '${body.role}'. Valid values: ${VALID_PROJECT_ROLES.join(', ')}`,
        });
      }

      const { projects, memberships, audit } = getRepositories();
      const project = await projects.findById(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const existing = await memberships.findMembership(userId, projectId);
      if (!existing) {
        return reply.code(404).send({ error: 'Membership not found' });
      }

      if (existing.role === 'project-admin' && body.role !== 'project-admin') {
        // Demoting the last project-admin → block
        const adminCount = await memberships.countAdmins(projectId);
        if (adminCount <= 1) {
          return reply.code(400).send({
            error: 'Cannot demote the last project-admin',
            code: 'LAST_PROJECT_ADMIN',
          });
        }
      }

      const record = await memberships.updateRole(userId, projectId, body.role);
      await audit.append({
        actor: request.user.id,
        action: 'project.member-role-updated',
        entityType: 'project_memberships',
        entityId: record.id,
        correlationId: request.correlationId,
        metadata: {
          projectId,
          targetUserId: userId,
          previousRole: existing.role,
          newRole: body.role,
          ip: request.ip,
        },
      });
      return reply.send({ data: record });
    },
  );

  // ── Remove member ──────────────────────────────────────────────────────────

  app.delete<{ Params: { id: string; userId: string } }>(
    '/projects/:id/members/:userId',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { id: projectId, userId } = request.params;
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId, 'project-admin')) return;

      const { projects, memberships, audit } = getRepositories();
      const project = await projects.findById(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const existing = await memberships.findMembership(userId, projectId);
      if (!existing) return reply.code(404).send({ error: 'Membership not found' });

      if (existing.role === 'project-admin') {
        const adminCount = await memberships.countAdmins(projectId);
        if (adminCount <= 1) {
          return reply.code(400).send({
            error: 'Cannot remove the last project-admin',
            code: 'LAST_PROJECT_ADMIN',
          });
        }
      }

      await memberships.removeMember(userId, projectId);
      await audit.append({
        actor: request.user.id,
        action: 'project.member-removed',
        entityType: 'project_memberships',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: {
          projectId,
          targetUserId: userId,
          previousRole: existing.role,
          ip: request.ip,
        },
      });

      log.info({ projectId, userId }, 'Member removed');
      return reply.code(204).send();
    },
  );
}
