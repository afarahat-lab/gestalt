/**
 * Constraint rules for the corporate operations web & mobile template.
 *
 * These rules are loaded by the constraint-agent and lint-config-agent
 * when a project is initialised with this template.
 *
 * Rules are enforced at two levels:
 *   - eslint: fast static import/style checks
 *   - ast: semantic architectural pattern checks
 */

import type { ConstraintRule } from '../../../packages/agents/quality-gate/src/types';

export const corporateOpsConstraints: ConstraintRule[] = [
  // ─── Module boundary rules ──────────────────────────────────────────────

  {
    id: 'no-cross-module-internals',
    description: 'Modules may only import from each other\'s index.ts, not internal files',
    level: 'eslint',
    severity: 'high',
    check: 'import/no-internal-modules',
  },
  {
    id: 'no-circular-deps',
    description: 'No circular dependencies between modules',
    level: 'eslint',
    severity: 'high',
    check: 'import/no-cycle',
  },

  // ─── Data access rules ──────────────────────────────────────────────────

  {
    id: 'no-direct-db-access',
    description: 'Database access only through repository pattern in src/shared/db/',
    level: 'ast',
    severity: 'high',
    check: 'no-direct-db-outside-repository',
  },
  {
    id: 'no-raw-sql',
    description: 'No raw SQL string concatenation — use parameterised queries only',
    level: 'ast',
    severity: 'high',
    check: 'no-raw-sql-concatenation',
  },

  // ─── API and security rules ─────────────────────────────────────────────

  {
    id: 'rbac-at-middleware',
    description: 'No user.role comparisons outside auth middleware files',
    level: 'eslint',
    severity: 'high',
    check: 'no-inline-rbac',
  },
  {
    id: 'zod-at-boundary',
    description: 'request.body must be validated with Zod before use',
    level: 'ast',
    severity: 'high',
    check: 'require-zod-validation',
  },
  {
    id: 'no-numeric-ids-in-api',
    description: 'API responses must not expose numeric database IDs',
    level: 'ast',
    severity: 'medium',
    check: 'no-numeric-id-in-response',
  },

  // ─── Audit rules ────────────────────────────────────────────────────────

  {
    id: 'audit-on-state-change',
    description: 'Every non-GET route handler must write an AuditLog record',
    level: 'ast',
    severity: 'high',
    check: 'audit-record-on-state-change',
  },

  // ─── Code quality rules ─────────────────────────────────────────────────

  {
    id: 'no-any',
    description: 'TypeScript any type is forbidden',
    level: 'eslint',
    severity: 'medium',
    check: '@typescript-eslint/no-explicit-any',
  },
  {
    id: 'no-console',
    description: 'Use the platform logger — no console.log/warn/error',
    level: 'eslint',
    severity: 'low',
    check: 'no-console',
  },
  {
    id: 'explicit-return-types',
    description: 'All exported functions must have explicit return types',
    level: 'eslint',
    severity: 'low',
    check: '@typescript-eslint/explicit-function-return-type',
  },
];
