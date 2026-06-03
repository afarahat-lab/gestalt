/**
 * Fastify authentication middleware.
 * Validates JWT, attaches user to request, enforces RBAC.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { PlatformUser } from '../types';
import {
  getRepositories, createContextLogger,
  type ProjectMembershipRecord, type ProjectRole,
} from '@gestalt/core';
import { verifyToken, extractToken } from './session';
import type { SessionConfig } from './session';

const log = createContextLogger({ module: 'auth-middleware' });

// Routes that do not require authentication
const PUBLIC_ROUTES = new Set([
  'GET /health',
  'GET /',  // 302-redirects to /app/ — convenience for `gestalt dashboard` users
  'GET /auth/providers',  // ADR-040 — login renderer needs to know which providers are available
  'GET /auth/kerberos',   // ADR-040 — issues the 401 + Negotiate challenge OR validates the token
  'GET /auth/saml/metadata',
  'GET /auth/saml/login',
  'POST /auth/saml/callback',
  'GET /auth/oidc/login',
  'GET /auth/oidc/callback',
  'POST /auth/login',
  'POST /auth/admin/setup',  // first-boot only — guarded by zero-user check
  'GET /events',   // SSE — token passed as query param, validated inside route
]);

// The SPA lives under /app/* and the API lives at the root and bare
// paths — no overlap. Any GET to a /app/* URL is a dashboard asset or
// SPA route and is served by fastify-static / the SPA fallback without
// auth (the SPA reads the JWT from localStorage and bounces to its own
// /login view if missing). Everything else is API and goes through the
// normal auth check.
function isSpaPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === '/app' || path.startsWith('/app/');
}

export async function registerAuthMiddleware(
  app: FastifyInstance,
  sessionConfig: SessionConfig,
): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === 'GET' && isSpaPath(request.url)) return;

    const routeKey = `${request.method} ${request.routerPath ?? request.url}`;
    if (PUBLIC_ROUTES.has(routeKey)) return;

    const token = extractToken(
      request.headers as Record<string, string | undefined>,
      request.query as Record<string, string | undefined>,
    );

    if (!token) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const payload = await verifyToken(token, sessionConfig);
      const { users } = getRepositories();
      const user = await users.findById(payload.sub);

      if (!user) {
        return reply.code(401).send({ error: 'User not found' });
      }

      // Migration 010 added the soft-delete column. A JWT issued before
      // deactivation is otherwise valid until expiry; this check ensures
      // an admin-driven deactivation takes effect on the very next
      // request rather than waiting for the session TTL.
      if (user.deactivatedAt) {
        log.warn(
          { userId: user.id, deactivatedAt: user.deactivatedAt },
          'Deactivated user attempted access',
        );
        return reply.code(403).send({ error: 'ACCOUNT_DEACTIVATED' });
      }

      request.user = user as unknown as PlatformUser;
    } catch (err) {
      log.warn({ err }, 'Token validation failed');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
}

/**
 * Resolves a project ID for the request, used by the membership-aware
 * legs of `requireRole`. Only two patterns are considered:
 *
 *   1. `/projects/:id/*` — `request.params.id` is the project id
 *   2. `?projectId=...` query — used by `/deployments`, `/maintenance/runs`,
 *      `/projects/:id/members` (the last one already covered by #1)
 *
 * Routes whose `:id` param is NOT a project ID (e.g.
 * `POST /intents/:id/clarify`, `GET /executions/:id/log`) MUST NOT
 * trigger a membership lookup against an unrelated UUID. We restrict
 * the params lookup to URLs whose router path begins with
 * `/projects/:id`.
 */
function getProjectIdForCheck(request: FastifyRequest): string | null {
  const routerPath = request.routerPath ?? '';
  if (routerPath.startsWith('/projects/:id')) {
    const params = request.params as { id?: string } | undefined;
    if (params?.id) return params.id;
  }
  const query = request.query as { projectId?: string } | undefined;
  if (query?.projectId) return query.projectId;
  return null;
}

/**
 * Route-level preHandler that enforces a minimum role.
 *
 * The string signature (`viewer` | `operator` | `admin`) is the legacy
 * vocabulary — preserved so existing route guards keep compiling. The
 * mapping after migration 010:
 *   - `admin` → platform-admin only
 *   - `operator` → platform-admin OR project (editor|project-admin) when
 *     the route exposes a project ID; otherwise any authenticated user
 *   - `viewer` → platform-admin OR any project member when the route
 *     exposes a project ID; otherwise any authenticated user
 *
 * platform-admin always bypasses the project membership check —
 * regardless of `minimumRole`.
 *
 * @example
 * app.post('/maintenance/trigger', { preHandler: requireRole('operator') }, handler)
 */
export function requireRole(minimumRole: 'viewer' | 'operator' | 'admin') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const isPlatformAdmin = user.role === 'platform-admin';

    if (minimumRole === 'admin') {
      if (!isPlatformAdmin) {
        return reply.code(403).send({
          error: 'Platform admin required',
          code: 'FORBIDDEN',
        });
      }
      return;
    }

    // platform-admin bypasses every project membership check
    if (isPlatformAdmin) return;

    const projectId = getProjectIdForCheck(request);
    if (!projectId) {
      // Route has no project context — authenticated user is enough.
      // Project-scoped writes that route the projectId through the body
      // (e.g. POST /intents) enforce membership at the handler level.
      return;
    }

    // Brief 1 — Bulk user management. Effective role is the higher of
    // direct membership (project_memberships) and any group-derived
    // role (platform_groups). The preHandler now mirrors what the
    // handler-level `requireProjectMembership` computes.
    const { memberships, platformGroups } = getRepositories();
    const [direct, groupEffective] = await Promise.all([
      memberships.findMembership(user.id, projectId),
      platformGroups.getEffectiveMemberships(user.id),
    ]);
    const groupAccess = groupEffective.find((m) => m.projectId === projectId);
    const effectiveRole = pickHigherRole(direct?.role ?? null, groupAccess?.role ?? null);

    if (!effectiveRole) {
      return reply.code(403).send({
        error: 'Not a member of this project',
        code: 'FORBIDDEN',
      });
    }

    if (minimumRole === 'operator' && effectiveRole === 'reader') {
      return reply.code(403).send({
        error: 'Editor or project-admin required',
        code: 'FORBIDDEN',
      });
    }
    // minimumRole === 'viewer' — any effective role is sufficient
  };
}

function pickHigherRole(
  a: ProjectRole | null,
  b: ProjectRole | null,
): ProjectRole | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return PROJECT_ROLE_RANK[a] >= PROJECT_ROLE_RANK[b] ? a : b;
}

/**
 * Handler-level membership check used by routes whose project context
 * lives in the request body (so the `requireRole` preHandler couldn't
 * look it up) or by routes that need a tighter minimum role than the
 * coarse `viewer/operator/admin` vocabulary of `requireRole`.
 *
 * Returns the membership record (or `null` for platform-admin users
 * who bypass the check) on success. Throws `ProjectMembershipError` on
 * failure; the caller maps that to a 403 with `code` + `message`.
 *
 * The role ranking matches the brief's table:
 *   project-admin > editor > reader
 *
 * Pass `minRole = 'editor'` for "needs to write" (submit intent,
 * trigger maintenance, clarify, fix-intent) and `'project-admin'` for
 * "needs to manage" (HARNESS.json config changes, membership
 * mutations).
 */
const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  reader: 1,
  editor: 2,
  'project-admin': 3,
};

export class ProjectMembershipError extends Error {
  constructor(
    public readonly code: 'NOT_PROJECT_MEMBER' | 'INSUFFICIENT_PROJECT_ROLE',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectMembershipError';
  }
}

export async function requireProjectMembership(
  userId: string,
  userPlatformRole: string,
  projectId: string,
  minRole: ProjectRole = 'reader',
): Promise<ProjectMembershipRecord | null> {
  if (userPlatformRole === 'platform-admin') return null;

  // Brief 1 — bulk user management. Effective access is the higher of
  // the user's direct `project_memberships` row AND any role derived
  // from `platform_groups`. Both lookups happen in parallel; the
  // comparison runs against the role-rank scale.
  const { memberships, platformGroups } = getRepositories();
  const [direct, groupEffective] = await Promise.all([
    memberships.findMembership(userId, projectId),
    platformGroups.getEffectiveMemberships(userId),
  ]);

  const directRank = direct ? PROJECT_ROLE_RANK[direct.role] : 0;
  const groupAccess = groupEffective.find((m) => m.projectId === projectId);
  const groupRank = groupAccess ? PROJECT_ROLE_RANK[groupAccess.role] : 0;
  const effectiveRank = Math.max(directRank, groupRank);

  if (effectiveRank === 0) {
    throw new ProjectMembershipError(
      'NOT_PROJECT_MEMBER',
      'You are not a member of this project',
    );
  }

  if (effectiveRank < PROJECT_ROLE_RANK[minRole]) {
    throw new ProjectMembershipError(
      'INSUFFICIENT_PROJECT_ROLE',
      `Minimum project role required: ${minRole}`,
    );
  }

  // Returns the direct membership row when present (callers that
  // need to mutate use this row's id; group-derived access has no
  // mutable surface — the operator manages it via the group itself).
  // Returns null when access is purely group-derived.
  return direct ?? null;
}

/**
 * Maps a `ProjectMembershipError` to a Fastify 403 reply with the
 * canonical body shape `{ error, code, message }`. Use in the catch
 * block of any handler that calls `requireProjectMembership`.
 */
export function sendProjectMembershipError(
  reply: FastifyReply,
  err: ProjectMembershipError,
): FastifyReply {
  return reply.code(403).send({
    error: 'FORBIDDEN',
    code: err.code,
    message: err.message,
  });
}

/**
 * One-line helper that wraps `requireProjectMembership` + the
 * `sendProjectMembershipError` reply path. Returns `true` when the
 * check passed (caller proceeds normally) and `false` when a 403
 * was sent (caller should `return;`). Non-membership errors are
 * rethrown so the route handler's normal error path catches them.
 *
 * Replaces the 7-line try/catch boilerplate that grew around every
 * handler-level membership check in the membership-enforcement
 * session.
 *
 * @example
 * if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId)) return;
 */
export async function checkProjectMembership(
  reply: FastifyReply,
  userId: string,
  platformRole: string,
  projectId: string,
  minRole: ProjectRole = 'reader',
): Promise<boolean> {
  try {
    await requireProjectMembership(userId, platformRole, projectId, minRole);
    return true;
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      sendProjectMembershipError(reply, err);
      return false;
    }
    throw err;
  }
}
