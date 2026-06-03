/**
 * Project membership repository — PostgreSQL implementation.
 *
 * One row per (user, project) pair; `role` is `project-admin` |
 * `editor` | `reader`. Migration 010 added the table and backfills a
 * `project-admin` row for every existing project (so the user who
 * originally registered the project keeps access after migration).
 *
 * `addMember` is upsert by (user_id, project_id) — the second call
 * updates the role and the assigning user. Keeps the `users assign`
 * CLI flow idempotent.
 */

import type {
  ProjectMembershipRepository, ProjectMembershipRecord, ProjectRole,
} from '@gestalt/core';
import { getDb } from '../client';

// postgres.js camelCases column names at the client level (see
// client.ts `transform: { column: postgres.toCamel }`). The returned
// rows already match `ProjectMembershipRecord` field-for-field, so no
// per-field mapping is needed.

export class PostgresProjectMembershipRepository implements ProjectMembershipRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async addMember(params: {
    userId: string;
    projectId: string;
    role: ProjectRole;
    assignedBy: string;
  }): Promise<ProjectMembershipRecord> {
    const db = getDb();
    const [row] = await db<ProjectMembershipRecord[]>`
      INSERT INTO project_memberships (user_id, project_id, role, assigned_by)
      VALUES (${params.userId}, ${params.projectId}, ${params.role}, ${params.assignedBy})
      ON CONFLICT (user_id, project_id) DO UPDATE SET
        role        = EXCLUDED.role,
        assigned_by = EXCLUDED.assigned_by
      RETURNING *
    `;
    return row;
  }

  async updateRole(
    userId: string,
    projectId: string,
    role: ProjectRole,
  ): Promise<ProjectMembershipRecord> {
    const db = getDb();
    const [row] = await db<ProjectMembershipRecord[]>`
      UPDATE project_memberships
      SET role = ${role}
      WHERE user_id = ${userId} AND project_id = ${projectId}
      RETURNING *
    `;
    if (!row) throw new Error(`Membership not found for user ${userId} on project ${projectId}`);
    return row;
  }

  async removeMember(userId: string, projectId: string): Promise<void> {
    const db = getDb();
    await db`
      DELETE FROM project_memberships
      WHERE user_id = ${userId} AND project_id = ${projectId}
    `;
  }

  async findByProject(projectId: string): Promise<ProjectMembershipRecord[]> {
    const db = getDb();
    const rows = await db<ProjectMembershipRecord[]>`
      SELECT * FROM project_memberships
      WHERE project_id = ${projectId}
      ORDER BY created_at ASC
    `;
    return rows;
  }

  async findByUser(userId: string): Promise<ProjectMembershipRecord[]> {
    const db = getDb();
    const rows = await db<ProjectMembershipRecord[]>`
      SELECT * FROM project_memberships
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
    return rows;
  }

  async findMembership(
    userId: string,
    projectId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const db = getDb();
    const [row] = await db<ProjectMembershipRecord[]>`
      SELECT * FROM project_memberships
      WHERE user_id = ${userId} AND project_id = ${projectId}
      LIMIT 1
    `;
    return row ? row : null;
  }

  async countAdmins(projectId: string): Promise<number> {
    const db = getDb();
    const [row] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM project_memberships
      WHERE project_id = ${projectId} AND role = 'project-admin'
    `;
    return parseInt(row.count, 10);
  }

  async countByProject(projectId: string): Promise<number> {
    const db = getDb();
    const [row] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM project_memberships
      WHERE project_id = ${projectId}
    `;
    return parseInt(row.count, 10);
  }

  async deleteAllForProject(projectId: string): Promise<number> {
    const db = getDb();
    // RETURNING-count trick: naked DELETE doesn't surface affected
    // rows on postgres.js. Same pattern `gcOlderThan` uses in the
    // deployment-events repo.
    const [{ count }] = await db<[{ count: string }]>`
      WITH deleted AS (
        DELETE FROM project_memberships WHERE project_id = ${projectId} RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM deleted
    `;
    return parseInt(count, 10);
  }
}
