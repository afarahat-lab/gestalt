/**
 * Platform groups repository — PostgreSQL implementation
 * (Brief 1 — bulk user management, migration 018).
 *
 * Bridges three tables — `platform_groups`, `group_memberships`,
 * `group_project_assignments` — plus the joined views the routes
 * consume. The hot-path method is `getEffectiveMemberships(userId)`:
 * the auth middleware calls it on every membership check, so the
 * query stays narrow (single JOIN, grouped by project_id with the
 * max role rank).
 *
 * Role precedence is computed in SQL via a CASE rank — `project-admin`
 * (3) > `editor` (2) > `reader` (1). `MAX(rank) → role` gives the
 * highest role across all the user's group memberships per project
 * in a single round trip.
 */

import type {
  PlatformGroupRepository, PlatformGroupRecord,
  GroupMemberWithUser, GroupProjectWithProject,
  EffectiveProjectMembership,
  UserRecord, ProjectRecord,
} from '@gestalt/core';
import { getDb } from '../client';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}

function rowToRecord(row: GroupRow): PlatformGroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export class PostgresPlatformGroupRepository implements PlatformGroupRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    try { await db`SELECT 1 FROM platform_groups LIMIT 1`; return true; }
    catch { return false; }
  }

  async list(): Promise<PlatformGroupRecord[]> {
    const db = getDb();
    const rows = await db<GroupRow[]>`
      SELECT * FROM platform_groups ORDER BY name ASC
    `;
    return rows.map(rowToRecord);
  }

  async findById(id: string): Promise<PlatformGroupRecord | null> {
    const db = getDb();
    const [row] = await db<GroupRow[]>`
      SELECT * FROM platform_groups WHERE id = ${id} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByName(name: string): Promise<PlatformGroupRecord | null> {
    const db = getDb();
    const [row] = await db<GroupRow[]>`
      SELECT * FROM platform_groups WHERE name = ${name} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async create(params: {
    name: string;
    description?: string | null;
    createdBy: string;
  }): Promise<PlatformGroupRecord> {
    const db = getDb();
    const [row] = await db<GroupRow[]>`
      INSERT INTO platform_groups (name, description, created_by)
      VALUES (${params.name}, ${params.description ?? null}, ${params.createdBy})
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async update(
    id: string,
    params: { name?: string; description?: string | null },
  ): Promise<PlatformGroupRecord> {
    const db = getDb();
    const setParts: ReturnType<typeof db>[] = [];
    if (params.name !== undefined)        setParts.push(db`name = ${params.name}`);
    if (params.description !== undefined) setParts.push(db`description = ${params.description}`);
    if (setParts.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Platform group ${id} not found`);
      return existing;
    }
    const [row] = await db<GroupRow[]>`
      UPDATE platform_groups
      SET ${setParts.flatMap((p, i) => i === 0 ? [p] : [db`, `, p])}
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Platform group ${id} not found`);
    return rowToRecord(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db`DELETE FROM platform_groups WHERE id = ${id}`;
  }

  // ─── Members ────────────────────────────────────────────────────────────

  async addMember(groupId: string, userId: string, addedBy: string): Promise<void> {
    const db = getDb();
    // ON CONFLICT DO NOTHING — re-adding an existing member is a no-op
    // (the operator may have clicked twice; we don't want it to throw).
    await db`
      INSERT INTO group_memberships (group_id, user_id, added_by)
      VALUES (${groupId}, ${userId}, ${addedBy})
      ON CONFLICT (group_id, user_id) DO NOTHING
    `;
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    const db = getDb();
    await db`
      DELETE FROM group_memberships
      WHERE group_id = ${groupId} AND user_id = ${userId}
    `;
  }

  async listMembers(groupId: string): Promise<GroupMemberWithUser[]> {
    const db = getDb();
    // Postgres.js camelCases the columns. The aliasing keeps the
    // nested `user` object clean — we project the user columns into
    // their own prefixed columns then assemble in JS.
    const rows = await db<Array<{
      groupId: string; userId: string; addedBy: string | null; addedAt: Date;
      userIdpSubject: string; userAuthProvider: string;
      userEmail: string; userDisplayName: string;
      userRole: 'platform-admin' | 'user'; userDeactivatedAt: Date | null;
      userIdpGroups: string[] | null; userCreatedAt: Date;
    }>>`
      SELECT
        m.group_id, m.user_id, m.added_by, m.added_at,
        u.idp_subject     AS user_idp_subject,
        u.auth_provider   AS user_auth_provider,
        u.email           AS user_email,
        u.display_name    AS user_display_name,
        u.role            AS user_role,
        u.deactivated_at  AS user_deactivated_at,
        u.idp_groups      AS user_idp_groups,
        u.created_at      AS user_created_at
      FROM group_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ${groupId}
      ORDER BY u.display_name ASC, u.email ASC
    `;
    return rows.map((r) => ({
      groupId: r.groupId,
      userId: r.userId,
      addedBy: r.addedBy,
      addedAt: r.addedAt,
      user: {
        id: r.userId,
        idpSubject: r.userIdpSubject,
        authProvider: r.userAuthProvider,
        email: r.userEmail,
        displayName: r.userDisplayName,
        role: r.userRole,
        deactivatedAt: r.userDeactivatedAt,
        idpGroups: r.userIdpGroups ?? [],
        createdAt: r.userCreatedAt,
      } as UserRecord,
    }));
  }

  // ─── Project assignments ────────────────────────────────────────────────

  async assignToProject(
    groupId: string,
    projectId: string,
    role: 'project-admin' | 'editor' | 'reader',
    assignedBy: string,
  ): Promise<void> {
    const db = getDb();
    // UPSERT — re-assigning with a different role updates in place.
    await db`
      INSERT INTO group_project_assignments
        (group_id, project_id, role, assigned_by)
      VALUES (${groupId}, ${projectId}, ${role}, ${assignedBy})
      ON CONFLICT (group_id, project_id) DO UPDATE
        SET role        = EXCLUDED.role,
            assigned_by = EXCLUDED.assigned_by,
            assigned_at = NOW()
    `;
  }

  async removeFromProject(groupId: string, projectId: string): Promise<void> {
    const db = getDb();
    await db`
      DELETE FROM group_project_assignments
      WHERE group_id = ${groupId} AND project_id = ${projectId}
    `;
  }

  async listProjectAssignments(groupId: string): Promise<GroupProjectWithProject[]> {
    const db = getDb();
    const rows = await db<Array<{
      groupId: string; projectId: string;
      role: 'project-admin' | 'editor' | 'reader';
      assignedBy: string | null; assignedAt: Date;
      projectName: string; projectGitUrl: string;
      projectDefaultBranch: string; projectCreatedBy: string;
      projectCreatedAt: Date;
    }>>`
      SELECT
        a.group_id, a.project_id, a.role, a.assigned_by, a.assigned_at,
        p.name           AS project_name,
        p.git_url        AS project_git_url,
        p.default_branch AS project_default_branch,
        p.created_by     AS project_created_by,
        p.created_at     AS project_created_at
      FROM group_project_assignments a
      JOIN projects p ON p.id = a.project_id
      WHERE a.group_id = ${groupId}
      ORDER BY p.name ASC
    `;
    return rows.map((r) => ({
      groupId: r.groupId,
      projectId: r.projectId,
      role: r.role,
      assignedBy: r.assignedBy,
      assignedAt: r.assignedAt,
      project: {
        id: r.projectId,
        name: r.projectName,
        gitUrl: r.projectGitUrl,
        defaultBranch: r.projectDefaultBranch,
        createdBy: r.projectCreatedBy,
        createdAt: r.projectCreatedAt,
      } as ProjectRecord,
    }));
  }

  // ─── Effective memberships ──────────────────────────────────────────────

  async listAssignedToProject(projectId: string): Promise<Array<{
    group: PlatformGroupRecord;
    role: 'project-admin' | 'editor' | 'reader';
    assignedAt: Date;
    memberCount: number;
  }>> {
    const db = getDb();
    // Single round-trip: project assignments → JOIN groups → LEFT JOIN
    // membership-count subquery. `LEFT JOIN` so a group with zero
    // members still appears with `memberCount: 0` rather than being
    // filtered out.
    const rows = await db<Array<{
      groupId: string; groupName: string; groupDescription: string | null;
      groupCreatedBy: string | null; groupCreatedAt: Date;
      role: 'project-admin' | 'editor' | 'reader';
      assignedAt: Date;
      memberCount: string;
    }>>`
      SELECT
        g.id          AS group_id,
        g.name        AS group_name,
        g.description AS group_description,
        g.created_by  AS group_created_by,
        g.created_at  AS group_created_at,
        a.role,
        a.assigned_at,
        COALESCE(mc.member_count, 0)::text AS member_count
      FROM group_project_assignments a
      JOIN platform_groups g ON g.id = a.group_id
      LEFT JOIN (
        SELECT group_id, COUNT(*)::int AS member_count
        FROM group_memberships
        GROUP BY group_id
      ) mc ON mc.group_id = g.id
      WHERE a.project_id = ${projectId}
      ORDER BY g.name ASC
    `;
    return rows.map((r) => ({
      group: {
        id: r.groupId,
        name: r.groupName,
        description: r.groupDescription,
        createdBy: r.groupCreatedBy,
        createdAt: r.groupCreatedAt,
      },
      role: r.role,
      assignedAt: r.assignedAt,
      memberCount: parseInt(r.memberCount, 10),
    }));
  }

  async getEffectiveMemberships(userId: string): Promise<EffectiveProjectMembership[]> {
    const db = getDb();
    // Single round-trip: JOIN memberships → assignments, group by
    // project_id, pick the highest role (CASE-rank) per group. The
    // CASE expression keeps the role-rank logic in SQL so the
    // application middleware just reads `effective_role`.
    const rows = await db<Array<{ projectId: string; effectiveRole: 'project-admin' | 'editor' | 'reader' }>>`
      SELECT
        a.project_id,
        (CASE MAX(
          CASE a.role
            WHEN 'project-admin' THEN 3
            WHEN 'editor'        THEN 2
            WHEN 'reader'        THEN 1
            ELSE 0
          END
        )
          WHEN 3 THEN 'project-admin'
          WHEN 2 THEN 'editor'
          WHEN 1 THEN 'reader'
        END)::text AS effective_role
      FROM group_memberships m
      JOIN group_project_assignments a USING (group_id)
      WHERE m.user_id = ${userId}
      GROUP BY a.project_id
    `;
    return rows.map((r) => ({
      projectId: r.projectId,
      role: r.effectiveRole,
    }));
  }
}
