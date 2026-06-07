/**
 * Feature repository — PostgreSQL implementation (migration 024).
 * Implements @gestalt/core FeatureRepository interface.
 *
 * Three tables, one file:
 *   - features          → top-level user-submitted feature
 *   - feature_phases    → the phase plan produced by planner-agent
 *   - feature_plan_log  → append-only operator-visible event log
 *
 * postgres.js auto-converts snake_case columns to camelCase on read
 * (see client.ts `transform.column: postgres.toCamel`), so the row
 * shapes returned by SELECT match `FeatureRecord` / `FeaturePhaseRecord`
 * / `FeaturePlanLogRecord` without manual mapping. JSONB columns
 * (`feature_phases.result`, `feature_plan_log.detail`) are read via
 * `parseJsonb` so a string-encoded payload doesn't surface as a string
 * to the agent.
 */

import type {
  FeatureRepository, FeatureRecord, FeaturePhaseRecord,
  FeaturePlanLogRecord, FeatureStatus, PhaseStatus,
} from '@gestalt/core';
import { getDb } from '../client';
import { parseJsonb } from '../utils';

export class PostgresFeatureRepository implements FeatureRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const result = await db`SELECT 1 AS ok`;
    return result[0]?.ok === 1;
  }

  // ── features ────────────────────────────────────────────────────

  async create(
    feature: Omit<FeatureRecord, 'createdAt' | 'updatedAt' | 'architecture' | 'phaseCount' | 'currentPhase' | 'status'>,
  ): Promise<FeatureRecord> {
    const db = getDb();
    const [row] = await db<FeatureRecord[]>`
      INSERT INTO features (id, project_id, title, description, created_by)
      VALUES (
        ${feature.id},
        ${feature.projectId},
        ${feature.title},
        ${feature.description},
        ${feature.createdBy}
      )
      RETURNING *
    `;
    return row;
  }

  async findById(id: string): Promise<FeatureRecord | null> {
    const db = getDb();
    const [row] = await db<FeatureRecord[]>`SELECT * FROM features WHERE id = ${id}`;
    return row ?? null;
  }

  async listByProject(projectId: string): Promise<FeatureRecord[]> {
    const db = getDb();
    return db<FeatureRecord[]>`
      SELECT * FROM features
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;
  }

  async updateStatus(id: string, status: FeatureStatus): Promise<FeatureRecord> {
    const db = getDb();
    const [row] = await db<FeatureRecord[]>`
      UPDATE features
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature ${id} not found`);
    return row;
  }

  async saveArchitectureAndPlan(
    id: string,
    params: { architecture: string; phaseCount: number },
  ): Promise<FeatureRecord> {
    const db = getDb();
    const [row] = await db<FeatureRecord[]>`
      UPDATE features
      SET architecture  = ${params.architecture},
          phase_count   = ${params.phaseCount},
          status        = 'in-progress',
          updated_at    = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature ${id} not found`);
    return row;
  }

  async setCurrentPhase(id: string, phaseIndex: number): Promise<FeatureRecord> {
    const db = getDb();
    const [row] = await db<FeatureRecord[]>`
      UPDATE features
      SET current_phase = ${phaseIndex}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature ${id} not found`);
    return row;
  }

  // ── feature_phases ──────────────────────────────────────────────

  async createPhase(
    phase: Omit<FeaturePhaseRecord, 'createdAt' | 'updatedAt' | 'status' | 'intentId' | 'result'>,
  ): Promise<FeaturePhaseRecord> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      INSERT INTO feature_phases (
        id, feature_id, phase_index, title, scope, architecture, dependencies
      ) VALUES (
        ${phase.id},
        ${phase.featureId},
        ${phase.phaseIndex},
        ${phase.title},
        ${phase.scope},
        ${phase.architecture},
        ${phase.dependencies as unknown as string}
      )
      RETURNING *
    `;
    return this.hydratePhase(row);
  }

  async findPhaseByIndex(featureId: string, phaseIndex: number): Promise<FeaturePhaseRecord | null> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      SELECT * FROM feature_phases
      WHERE feature_id = ${featureId} AND phase_index = ${phaseIndex}
    `;
    return row ? this.hydratePhase(row) : null;
  }

  async listPhases(featureId: string): Promise<FeaturePhaseRecord[]> {
    const db = getDb();
    const rows = await db<FeaturePhaseRecord[]>`
      SELECT * FROM feature_phases
      WHERE feature_id = ${featureId}
      ORDER BY phase_index ASC
    `;
    return rows.map((r) => this.hydratePhase(r));
  }

  async updatePhaseIntent(phaseId: string, intentId: string): Promise<FeaturePhaseRecord> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      UPDATE feature_phases
      SET intent_id = ${intentId}, status = 'in-progress', updated_at = NOW()
      WHERE id = ${phaseId}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature phase ${phaseId} not found`);
    return this.hydratePhase(row);
  }

  async updatePhaseStatus(phaseId: string, status: PhaseStatus): Promise<FeaturePhaseRecord> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      UPDATE feature_phases
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${phaseId}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature phase ${phaseId} not found`);
    return this.hydratePhase(row);
  }

  async savePhaseResult(phaseId: string, result: unknown): Promise<FeaturePhaseRecord> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      UPDATE feature_phases
      SET result = ${JSON.stringify(result)}::jsonb, updated_at = NOW()
      WHERE id = ${phaseId}
      RETURNING *
    `;
    if (!row) throw new Error(`Feature phase ${phaseId} not found`);
    return this.hydratePhase(row);
  }

  async findPhaseByIntent(intentId: string): Promise<FeaturePhaseRecord | null> {
    const db = getDb();
    const [row] = await db<FeaturePhaseRecord[]>`
      SELECT * FROM feature_phases WHERE intent_id = ${intentId}
    `;
    return row ? this.hydratePhase(row) : null;
  }

  // ── feature_plan_log ────────────────────────────────────────────

  async appendLog(
    entry: Omit<FeaturePlanLogRecord, 'id' | 'createdAt'>,
  ): Promise<FeaturePlanLogRecord> {
    const db = getDb();
    const [row] = await db<FeaturePlanLogRecord[]>`
      INSERT INTO feature_plan_log (
        id, feature_id, phase_index, event_type, summary, detail
      ) VALUES (
        ${crypto.randomUUID()},
        ${entry.featureId},
        ${entry.phaseIndex},
        ${entry.eventType},
        ${entry.summary},
        ${entry.detail === null || entry.detail === undefined ? null : JSON.stringify(entry.detail)}::jsonb
      )
      RETURNING *
    `;
    return this.hydrateLog(row);
  }

  async listLog(featureId: string): Promise<FeaturePlanLogRecord[]> {
    const db = getDb();
    const rows = await db<FeaturePlanLogRecord[]>`
      SELECT * FROM feature_plan_log
      WHERE feature_id = ${featureId}
      ORDER BY created_at ASC
    `;
    return rows.map((r) => this.hydrateLog(r));
  }

  // ── helpers ─────────────────────────────────────────────────────

  private hydratePhase(row: FeaturePhaseRecord): FeaturePhaseRecord {
    return {
      ...row,
      // dependencies is a TEXT[] — postgres.js returns it as a JS array
      // already; defensive cast for older drivers.
      dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
      result: parseJsonb<unknown>(row.result, null),
    };
  }

  private hydrateLog(row: FeaturePlanLogRecord): FeaturePlanLogRecord {
    return {
      ...row,
      detail: parseJsonb<unknown>(row.detail, null),
    };
  }
}
