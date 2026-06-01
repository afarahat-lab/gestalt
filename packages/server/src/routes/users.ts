/**
 * User management routes (migration 010).
 *
 *   GET    /users               — platform-admin only; optional ?search=
 *   POST   /users               — create a user (+ optional password,
 *                                  + optional initial project assignments)
 *   GET    /users/:id           — platform-admin OR self
 *   PATCH  /users/:id           — platform-admin; change role / displayName
 *   DELETE /users/:id           — platform-admin; soft-delete (deactivate)
 *
 * GP-002 — every mutation appends an audit row.
 * GP-004 — passwords are bcrypt-hashed; the API never returns them.
 *
 * Self-protection:
 *   - cannot demote self (PATCH role → 'user')
 *   - cannot deactivate self
 */

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import {
  getRepositories, createContextLogger,
  type UserRole, type ProjectRole, type UserRecord,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:users' });

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const VALID_PLATFORM_ROLES: readonly UserRole[] = ['platform-admin', 'user'];
const VALID_PROJECT_ROLES: readonly ProjectRole[] = ['project-admin', 'editor', 'reader'];

interface CreateUserBody {
  email: string;
  displayName: string;
  role: UserRole;
  password?: string;
  projectAssignments?: Array<{
    projectId: string;
    role: ProjectRole;
  }>;
}

interface UpdateUserBody {
  role?: UserRole;
  displayName?: string;
}

/** Public projection — strips fields like internal flags; passwords were never on this record. */
function toPublic(user: UserRecord): UserRecord {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    authProvider: user.authProvider,
    idpSubject: user.idpSubject,
    idpGroups: user.idpGroups,
    lastLoginAt: user.lastLoginAt,
    deactivatedAt: user.deactivatedAt,
    createdAt: user.createdAt,
  };
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {

  // ── List users ──────────────────────────────────────────────────────────────

  app.get<{ Querystring: { search?: string } }>(
    '/users',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      const { users } = getRepositories();
      const rows = await users.list({ search: request.query?.search });
      return reply.send({ data: rows.map(toPublic) });
    },
  );

  // ── Create user ─────────────────────────────────────────────────────────────

  app.post<{ Body: CreateUserBody }>(
    '/users',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      const body = request.body ?? ({} as CreateUserBody);
      const { email, displayName, role, password, projectAssignments = [] } = body;

      if (!email?.trim() || !displayName?.trim() || !role) {
        return reply.code(400).send({
          error: 'email, displayName, and role are required',
        });
      }
      if (!VALID_PLATFORM_ROLES.includes(role)) {
        return reply.code(400).send({
          error: `Invalid role '${role}'. Valid values: ${VALID_PLATFORM_ROLES.join(', ')}`,
        });
      }
      if (password !== undefined && password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        });
      }
      for (const assignment of projectAssignments) {
        if (!VALID_PROJECT_ROLES.includes(assignment.role)) {
          return reply.code(400).send({
            error: `Invalid project role '${assignment.role}' in assignments`,
          });
        }
      }

      const normalisedEmail = email.trim().toLowerCase();
      const { users, localAuth, memberships, audit } = getRepositories();

      const existing = await users.findByEmail(normalisedEmail);
      if (existing) {
        return reply.code(409).send({
          error: `User with email '${normalisedEmail}' already exists`,
          code: 'USER_EMAIL_TAKEN',
        });
      }

      const authProvider = password && password.length > 0 ? 'local' : 'pending';

      const user = await users.upsert({
        email: normalisedEmail,
        displayName: displayName.trim(),
        role,
        authProvider,
        idpSubject: normalisedEmail,
        idpGroups: [],
        lastLoginAt: new Date(),
      });

      if (password && password.length > 0) {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await localAuth.create({
          userId: user.id,
          email: normalisedEmail,
          passwordHash,
        });
      }

      for (const assignment of projectAssignments) {
        await memberships.addMember({
          userId: user.id,
          projectId: assignment.projectId,
          role: assignment.role,
          assignedBy: request.user.id,
        });
      }

      await audit.append({
        actor: request.user.id,
        action: 'user.created',
        entityType: 'users',
        entityId: user.id,
        correlationId: request.correlationId,
        metadata: {
          email: user.email,
          role: user.role,
          authProvider,
          projectAssignmentCount: projectAssignments.length,
          ip: request.ip,
        },
      });

      log.info({ userId: user.id, email: user.email, role: user.role }, 'User created');
      return reply.code(201).send({ data: toPublic(user) });
    },
  );

  // ── Get user (with memberships) ────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/users/:id',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const targetId = request.params.id;
      const isSelf = request.user.id === targetId;
      const isPlatformAdmin = request.user.role === 'platform-admin';

      if (!isSelf && !isPlatformAdmin) {
        return reply.code(403).send({ error: 'Platform admin or self required' });
      }

      const { users, memberships } = getRepositories();
      const user = await users.findById(targetId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const userMemberships = await memberships.findByUser(targetId);
      return reply.send({
        data: { ...toPublic(user), memberships: userMemberships },
      });
    },
  );

  // ── Patch user (role / displayName) ────────────────────────────────────────

  app.patch<{ Params: { id: string }; Body: UpdateUserBody }>(
    '/users/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      const targetId = request.params.id;
      const body = request.body ?? ({} as UpdateUserBody);
      const { users, audit } = getRepositories();

      const target = await users.findById(targetId);
      if (!target) return reply.code(404).send({ error: 'User not found' });

      let updated = target;
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (body.role !== undefined) {
        if (!VALID_PLATFORM_ROLES.includes(body.role)) {
          return reply.code(400).send({
            error: `Invalid role '${body.role}'. Valid values: ${VALID_PLATFORM_ROLES.join(', ')}`,
          });
        }
        if (target.id === request.user.id && body.role !== 'platform-admin') {
          return reply.code(400).send({
            error: 'Cannot demote yourself from platform-admin',
            code: 'SELF_DEMOTION_FORBIDDEN',
          });
        }
        if (target.role !== body.role) {
          updated = await users.updateRole(target.id, body.role);
          changes['role'] = { from: target.role, to: body.role };
        }
      }

      if (body.displayName !== undefined && body.displayName.trim().length > 0) {
        const newName = body.displayName.trim();
        if (newName !== target.displayName) {
          updated = await users.updateDisplayName(target.id, newName);
          changes['displayName'] = { from: target.displayName, to: newName };
        }
      }

      if (Object.keys(changes).length > 0) {
        await audit.append({
          actor: request.user.id,
          action: 'user.updated',
          entityType: 'users',
          entityId: target.id,
          correlationId: request.correlationId,
          metadata: { changes, ip: request.ip },
        });
      }

      return reply.send({ data: toPublic(updated) });
    },
  );

  // ── Deactivate (soft-delete) ───────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const targetId = request.params.id;

      if (targetId === request.user.id) {
        return reply.code(400).send({
          error: 'Cannot deactivate yourself',
          code: 'SELF_DEACTIVATE_FORBIDDEN',
        });
      }

      const { users, audit } = getRepositories();
      const target = await users.findById(targetId);
      if (!target) return reply.code(404).send({ error: 'User not found' });

      if (target.deactivatedAt) {
        // Idempotent — already deactivated. Returning 204 keeps the
        // CLI's "users deactivate" command predictable on retries.
        return reply.code(204).send();
      }

      await users.deactivate(target.id);
      await audit.append({
        actor: request.user.id,
        action: 'user.deactivated',
        entityType: 'users',
        entityId: target.id,
        correlationId: request.correlationId,
        metadata: { email: target.email, ip: request.ip },
      });

      log.info({ userId: target.id, email: target.email }, 'User deactivated');
      return reply.code(204).send();
    },
  );
}
