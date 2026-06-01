/**
 * First-boot admin setup route.
 *
 * POST /auth/admin/setup
 *   Creates the first admin user when the platform has zero users.
 *   Public (no JWT) — guarded by the zero-user check.
 *   Returns 403 once any user exists.
 *
 * The route hashes the password with bcrypt, inserts the user with
 * role: 'platform-admin' and authProvider: 'local', creates the local_auth credential
 * row, writes an audit record (GP-002), and issues a JWT so the operator is
 * signed in immediately.
 */

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { getRepositories, createContextLogger } from '@gestalt/core';
import { issueToken } from '../auth/session';
import type { SessionConfig } from '../auth/session';

const log = createContextLogger({ module: 'routes:admin' });

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

interface AdminSetupBody {
  email: string;
  password: string;
  displayName: string;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  sessionConfig: SessionConfig,
): Promise<void> {

  app.post<{ Body: AdminSetupBody }>(
    '/auth/admin/setup',
    async (request, reply) => {
      const { email, password, displayName } = request.body ?? ({} as AdminSetupBody);

      if (!email?.trim() || !password || !displayName?.trim()) {
        return reply.code(400).send({
          error: 'email, password, and displayName are required',
        });
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        });
      }

      const { users, localAuth, audit } = getRepositories();

      // First-boot guard — only works when the platform has zero users.
      const existingCount = await users.count();
      if (existingCount > 0) {
        log.warn(
          { existingCount, attemptedEmail: email },
          'Admin setup attempted after users exist',
        );
        return reply.code(403).send({
          error:
            'Admin setup is only available on a fresh installation. ' +
            'A user already exists — use the regular login flow.',
          code: 'ADMIN_ALREADY_EXISTS',
        });
      }

      const normalisedEmail = email.trim().toLowerCase();
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Create the shadow user record first so local_auth.user_id has a target.
      const user = await users.upsert({
        email: normalisedEmail,
        displayName: displayName.trim(),
        role: 'platform-admin',
        authProvider: 'local',
        idpSubject: normalisedEmail,
        idpGroups: [],
        lastLoginAt: new Date(),
      });

      await localAuth.create({
        userId: user.id,
        email: normalisedEmail,
        passwordHash,
      });

      // GP-002 — first-boot setup is auditable. There is no authenticated user
      // yet, so the audit hook would skip; write the record explicitly.
      await audit.append({
        actor: user.id,
        action: 'POST /auth/admin/setup',
        entityType: 'users',
        entityId: user.id,
        correlationId: request.correlationId,
        metadata: {
          email: normalisedEmail,
          role: 'platform-admin',
          authProvider: 'local',
          source: 'first-boot-setup',
          ip: request.ip,
        },
      });

      log.info({ userId: user.id, email: normalisedEmail }, 'First admin created');

      const token = await issueToken(user as never, sessionConfig);

      return reply.code(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          authProvider: user.authProvider,
        },
      });
    },
  );
}
