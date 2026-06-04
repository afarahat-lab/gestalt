/**
 * Project repository — PostgreSQL implementation (ADR-032).
 *
 * One row per project in `projects`; one row per project in
 * `project_git_credentials`, related by FK with ON DELETE CASCADE.
 *
 * Projects may also reference a vault secret via `git_secret_id`
 * (migration 022). When present, the vault secret takes precedence
 * over the plain `project_git_credentials.token` — see
 * `resolveProjectCredential` in `BaseOrchestrator`. The plain-token
 * path is preserved for backward compatibility with projects
 * registered before vault support shipped.
 */

import type { ProjectRepository, ProjectRecord } from '@gestalt/core';
import { getDb } from '../client';

export class PostgresProjectRepository implements ProjectRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(
    project: Omit<ProjectRecord, 'id' | 'createdAt' | 'gitSecretId'>,
  ): Promise<ProjectRecord> {
    const db = getDb();
    const [row] = await db<ProjectRecord[]>`
      INSERT INTO projects (name, git_url, default_branch, created_by)
      VALUES (
        ${project.name},
        ${project.gitUrl},
        ${project.defaultBranch},
        ${project.createdBy}
      )
      RETURNING *
    `;
    return row;
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const db = getDb();
    const [row] = await db<ProjectRecord[]>`
      SELECT * FROM projects WHERE id = ${id}
    `;
    return row ?? null;
  }

  async findByName(name: string): Promise<ProjectRecord | null> {
    const db = getDb();
    const [row] = await db<ProjectRecord[]>`
      SELECT * FROM projects WHERE name = ${name}
    `;
    return row ?? null;
  }

  async list(userId: string): Promise<ProjectRecord[]> {
    const db = getDb();
    return db<ProjectRecord[]>`
      SELECT * FROM projects
      WHERE created_by = ${userId}
      ORDER BY created_at DESC
    `;
  }

  async listAll(): Promise<ProjectRecord[]> {
    const db = getDb();
    return db<ProjectRecord[]>`
      SELECT * FROM projects ORDER BY created_at DESC
    `;
  }

  async saveCredential(projectId: string, token: string): Promise<void> {
    // TODO: encrypt at rest before production use.
    const db = getDb();
    await db`
      INSERT INTO project_git_credentials (project_id, token)
      VALUES (${projectId}, ${token})
    `;
  }

  async getCredential(projectId: string): Promise<string | null> {
    const db = getDb();
    const [row] = await db<{ token: string }[]>`
      SELECT token FROM project_git_credentials
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return row?.token ?? null;
  }

  async delete(projectId: string): Promise<number> {
    const db = getDb();
    const [{ count }] = await db<[{ count: string }]>`
      WITH deleted AS (
        DELETE FROM projects WHERE id = ${projectId} RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM deleted
    `;
    return parseInt(count, 10);
  }

  async deleteAllCredentials(projectId: string): Promise<number> {
    const db = getDb();
    const [{ count }] = await db<[{ count: string }]>`
      WITH deleted AS (
        DELETE FROM project_git_credentials WHERE project_id = ${projectId} RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM deleted
    `;
    return parseInt(count, 10);
  }

  async saveGitSecretRef(
    projectId: string,
    secretId: string | null,
  ): Promise<void> {
    const db = getDb();
    await db`
      UPDATE projects
      SET git_secret_id = ${secretId}
      WHERE id = ${projectId}
    `;
  }
}
