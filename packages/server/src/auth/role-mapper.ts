/**
 * Role mapper — maps IdP group claims to the platform role.
 *
 * Two-level model:
 *   - Platform role on `users.role`: `platform-admin` | `user`
 *   - Per-project role on `project_memberships.role`:
 *     `project-admin` | `editor` | `reader`
 *
 * This module only deals with the platform role. Per-project access
 * checks live in `requireRole` / route handlers and consult the
 * memberships repository.
 *
 * Rules:
 * - First matching role mapping wins (order matters in HARNESS.json)
 * - If no group matches and `defaultRole` is set, `defaultRole` is used
 * - If no group matches and `defaultRole` is null, access is denied
 * - Local auth users bypass group mapping — their role is stored
 *   directly on the user record (set at first-boot for the initial
 *   admin; set by other admins through `POST /users` afterwards).
 */

import type { VerifiedIdentity, UserRole, RoleMapping } from './types';

export interface RoleResolutionResult {
  role: UserRole;
  matchedGroup: string | null;
  source: 'group-mapping' | 'default-role' | 'local-assignment';
}

export interface RoleResolutionDenied {
  denied: true;
  reason: string;
}

export type RoleResolution = RoleResolutionResult | RoleResolutionDenied;

/**
 * Resolves the platform role for a verified IdP identity.
 *
 * For local-auth users this returns `'user'` as a safe default; the
 * caller (AuthManager) actually preserves the stored role on every
 * subsequent login, so the initial admin (set at first-boot) keeps
 * `platform-admin` regardless of what this function returns.
 */
export function resolveRole(
  identity: VerifiedIdentity,
  mappings: RoleMapping[],
  defaultRole: UserRole | null,
): RoleResolution {
  if (identity.provider === 'local') {
    return {
      role: 'user',
      matchedGroup: null,
      source: 'local-assignment',
    };
  }

  for (const mapping of mappings) {
    if (identity.groups.includes(mapping.idpGroup)) {
      return {
        role: mapping.platformRole,
        matchedGroup: mapping.idpGroup,
        source: 'group-mapping',
      };
    }
  }

  if (defaultRole !== null) {
    return {
      role: defaultRole,
      matchedGroup: null,
      source: 'default-role',
    };
  }

  return {
    denied: true,
    reason:
      `User '${identity.email}' is not a member of any mapped group. ` +
      `Groups found: [${identity.groups.join(', ') || 'none'}]. ` +
      `Configure roleMapping in HARNESS.json to grant access.`,
  };
}

/** Returns true if the role resolution resulted in a denial. */
export function isDenied(result: RoleResolution): result is RoleResolutionDenied {
  return 'denied' in result && result.denied === true;
}

/**
 * Backward-compatible permission check used by the `requireRole`
 * middleware. Maps the legacy minimum-role string (admin / operator /
 * viewer) onto the new model.
 *
 * - `admin` minimum  → only `platform-admin` users
 * - `operator` minimum → `platform-admin` always; `user` allowed only if
 *   the route has a project context AND the membership role is
 *   `project-admin` or `editor`. Routes without project context fall
 *   back to "authenticated user".
 * - `viewer` minimum → `platform-admin` always; `user` allowed only if
 *   the route has a project context AND the user has any membership.
 *   Routes without project context fall back to "authenticated user".
 *
 * The project-context branches live in the middleware (it needs the
 * request to extract the project ID); this function only answers the
 * "could this user *possibly* satisfy `minRole`?" question.
 */
export function isPlatformAdmin(role: UserRole): boolean {
  return role === 'platform-admin';
}
