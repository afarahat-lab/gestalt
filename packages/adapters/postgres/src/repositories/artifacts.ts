/**
 * Artifact repository — PostgreSQL implementation.
 * Stores agent-produced files (code, tests, context, designs, lint config).
 */

import type { ArtifactRepository, Artifact, ArtifactType } from '@gestalt/core';
import { getDb } from '../client';

export class PostgresArtifactRepository implements ArtifactRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async save(artifact: Artifact): Promise<Artifact> {
    const db = getDb();
    const [row] = await db<Artifact[]>`
      INSERT INTO artifacts (
        id, correlation_id, type, path, content, produced_by
      ) VALUES (
        ${artifact.id},
        ${artifact.correlationId},
        ${artifact.type},
        ${artifact.path},
        ${artifact.content},
        ${artifact.producedBy}
      )
      RETURNING *
    `;
    return row;
  }

  async findByCorrelationId(
    correlationId: string,
    type?: ArtifactType,
  ): Promise<Artifact[]> {
    const db = getDb();
    return db<Artifact[]>`
      SELECT * FROM artifacts
      WHERE correlation_id = ${correlationId}
      ${type ? db`AND type = ${type}` : db``}
      ORDER BY created_at ASC
    `;
  }

  async findById(id: string): Promise<Artifact | null> {
    const db = getDb();
    const [row] = await db<Artifact[]>`
      SELECT * FROM artifacts WHERE id = ${id}
    `;
    return row ?? null;
  }
}
