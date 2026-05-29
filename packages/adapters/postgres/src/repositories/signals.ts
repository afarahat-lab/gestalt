/**
 * Signal repository — PostgreSQL implementation.
 * Stores typed feedback signals (CONSTRAINT_VIOLATION, GOLDEN_PRINCIPLE_BREACH,
 * TEST_FAILURE, LINT_FAILURE, CONTEXT_GAP). See AGENTS.md for the vocabulary.
 *
 * GOLDEN_PRINCIPLE_BREACH is never auto-resolved (CLAUDE.md / GP enforcement).
 */

import type {
  SignalRepository, PlatformSignal, AgentRole, CodeLocation,
} from '@gestalt/core';
import { getDb } from '../client';

interface SignalRow {
  id: string;
  correlationId: string;
  type: PlatformSignal['type'];
  severity: PlatformSignal['severity'];
  sourceAgent: AgentRole;
  message: string;
  location: CodeLocation | null;
  autoResolvable: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

function rowToSignal(row: SignalRow): PlatformSignal {
  const signal: PlatformSignal = {
    id: row.id,
    correlationId: row.correlationId,
    type: row.type,
    severity: row.severity,
    sourceAgent: row.sourceAgent,
    message: row.message,
    autoResolvable: row.autoResolvable,
    createdAt: row.createdAt,
  };
  if (row.location) signal.location = row.location;
  return signal;
}

export class PostgresSignalRepository implements SignalRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async save(signal: PlatformSignal): Promise<PlatformSignal> {
    const db = getDb();
    const [row] = await db<SignalRow[]>`
      INSERT INTO signals (
        id, correlation_id, type, severity, source_agent,
        message, location, auto_resolvable
      ) VALUES (
        ${signal.id},
        ${signal.correlationId},
        ${signal.type},
        ${signal.severity},
        ${signal.sourceAgent},
        ${signal.message},
        ${signal.location ? JSON.stringify(signal.location) : null},
        ${signal.autoResolvable}
      )
      RETURNING *
    `;
    return rowToSignal(row);
  }

  async findByCorrelationId(correlationId: string): Promise<PlatformSignal[]> {
    const db = getDb();
    const rows = await db<SignalRow[]>`
      SELECT * FROM signals
      WHERE correlation_id = ${correlationId}
      ORDER BY created_at ASC
    `;
    return rows.map(rowToSignal);
  }

  async findUnresolved(): Promise<PlatformSignal[]> {
    const db = getDb();
    const rows = await db<SignalRow[]>`
      SELECT * FROM signals
      WHERE resolved_at IS NULL
      ORDER BY created_at ASC
    `;
    return rows.map(rowToSignal);
  }

  async markResolved(id: string, resolvedBy: AgentRole | 'human'): Promise<void> {
    const db = getDb();
    // GP guard: GOLDEN_PRINCIPLE_BREACH signals require human resolution.
    const [signal] = await db<{ type: string; autoResolvable: boolean }[]>`
      SELECT type, auto_resolvable FROM signals WHERE id = ${id}
    `;
    if (!signal) throw new Error(`Signal ${id} not found`);
    if (signal.type === 'GOLDEN_PRINCIPLE_BREACH' && resolvedBy !== 'human') {
      throw new Error(
        'GOLDEN_PRINCIPLE_BREACH signals can only be resolved by a human.',
      );
    }

    await db`
      UPDATE signals
      SET resolved_by = ${resolvedBy}, resolved_at = NOW()
      WHERE id = ${id}
    `;
  }
}
