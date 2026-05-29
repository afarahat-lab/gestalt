/**
 * Agent execution repository — PostgreSQL implementation.
 * Tracks one row per agent task: which agent, which intent, status, timings.
 */

import type {
  AgentExecutionRepository, AgentExecutionRecord, ExecutionStatus,
} from '@gestalt/core';
import { getDb } from '../client';

const ACTIVE_STATUSES: ExecutionStatus[] = ['queued', 'running'];

export class PostgresAgentExecutionRepository implements AgentExecutionRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(
    execution: Omit<AgentExecutionRecord, 'createdAt'>,
  ): Promise<AgentExecutionRecord> {
    const db = getDb();
    const [row] = await db<AgentExecutionRecord[]>`
      INSERT INTO agent_executions (
        id, correlation_id, intent_id, agent_role, task_type,
        status, tokens_used, duration_ms, started_at, completed_at
      ) VALUES (
        ${execution.id},
        ${execution.correlationId},
        ${execution.intentId},
        ${execution.agentRole},
        ${execution.taskType},
        ${execution.status},
        ${execution.tokensUsed},
        ${execution.durationMs},
        ${execution.startedAt},
        ${execution.completedAt}
      )
      RETURNING *
    `;
    return row;
  }

  async updateStatus(
    id: string,
    status: ExecutionStatus,
    fields?: Partial<AgentExecutionRecord>,
  ): Promise<AgentExecutionRecord> {
    const db = getDb();
    const [row] = await db<AgentExecutionRecord[]>`
      UPDATE agent_executions
      SET
        status        = ${status},
        tokens_used   = COALESCE(${fields?.tokensUsed ?? null}, tokens_used),
        duration_ms   = COALESCE(${fields?.durationMs ?? null}, duration_ms),
        started_at    = COALESCE(${fields?.startedAt ?? null}, started_at),
        completed_at  = COALESCE(${fields?.completedAt ?? null}, completed_at)
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Agent execution ${id} not found`);
    return row;
  }

  async findByCorrelationId(correlationId: string): Promise<AgentExecutionRecord[]> {
    const db = getDb();
    return db<AgentExecutionRecord[]>`
      SELECT * FROM agent_executions
      WHERE correlation_id = ${correlationId}
      ORDER BY created_at ASC
    `;
  }

  async findActive(): Promise<AgentExecutionRecord[]> {
    const db = getDb();
    return db<AgentExecutionRecord[]>`
      SELECT * FROM agent_executions
      WHERE status IN ${db(ACTIVE_STATUSES)}
      ORDER BY created_at ASC
    `;
  }
}
