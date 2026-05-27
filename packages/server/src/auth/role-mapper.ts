/**
 * Role mapper — maps IdP group claims to platform roles.
 *
 * This is the single place where group membership → platform role is resolved.
 * All auth providers produce a VerifiedIdentity with a groups array.
 * The role mapper turns that into a UserRole.
 *
 * Rules:
 * - First matching role mapping wins (order matters in HARNESS.json)
 * - If no group matches and defaultRole is set, defaultRole is used
 * - If no group matches and defaultRole is null, access is denied
 * - local fallback users bypass group mapping — their role is stored directly
 */

import type { VerifiedIdentity, UserRole, RoleMapping } from './types';

export interface RoleResolutionResult {
  role: UserRole;
  matchedGroup: string | null;    // which group triggered the role assignment
  source: 'group-mapping' | 'default-role' | 'local-assignment';
}

export interface RoleResolutionDenied {
  denied: true;
  reason: string;
}

export type RoleResolution = RoleResolutionResult | RoleResolutionDenied;

/**
 * Resolves the platform role for a verified identity.
 * Returns a denial if no role can be assigned.
 */
export function resolveRole(
  identity: VerifiedIdentity,
  mappings: RoleMapping[],
  defaultRole: UserRole | null,
): RoleResolution {
  // Local auth users have their role assigned directly — no group mapping
  if (identity.provider === 'local') {
    return {
      role: 'operator',   // local users default to operator; admin must be set manually
      matchedGroup: null,
      source: 'local-assignment',
    };
  }

  // Find first matching group mapping
  for (const mapping of mappings) {
    if (identity.groups.includes(mapping.idpGroup)) {
      return {
        role: mapping.platformRole,
        matchedGroup: mapping.idpGroup,
        source: 'group-mapping',
      };
    }
  }

  // No group match — apply default role if configured
  if (defaultRole !== null) {
    return {
      role: defaultRole,
      matchedGroup: null,
      source: 'default-role',
    };
  }

  // No role assigned — deny access
  return {
    denied: true,
    reason:
      `User '${identity.email}' is not a member of any mapped group. ` +
      `Groups found: [${identity.groups.join(', ') || 'none'}]. ` +
      `Configure roleMapping in HARNESS.json to grant access.`,
  };
}

/**
 * Returns true if the role resolution resulted in a denial.
 */
export function isDenied(result: RoleResolution): result is RoleResolutionDenied {
  return 'denied' in result && result.denied === true;
}

/**
 * Returns true if the user has sufficient role for the required permission.
 * Role hierarchy: admin > operator > viewer
 */
export function hasPermission(
  userRole: UserRole,
  requiredRole: UserRole,
): boolean {
  const hierarchy: Record<UserRole, number> = {
    viewer: 1,
    operator: 2,
    admin: 3,
  };
  return hierarchy[userRole] >= hierarchy[requiredRole];
}
