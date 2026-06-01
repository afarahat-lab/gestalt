/**
 * Agent execution log repository — PostgreSQL implementation.
 *
 * One row per `agent_executions` row; persisted by the layer
 * orchestrators (generate / quality-gate / deploy) right before they
 * transition the execution to a terminal state. Read by the dashboard's
 * IntentDetail accordion when an operator clicks an execution row.
 */

import type {
  AgentExecutionLogRepository, AgentExecutionLogRecord,
} from '@gestalt/core';
import { getDb } from '../client';

interface LogRow {
  id: string;
  executionId: string;
  correlationId: string;
  agentRole: string;
  prompt: string | null;
  llmResponse: string | null;
  resultStatus: string;
  artifactPaths: string[] | null;
  signalTypes: string[] | null;
  errorMessage: string | null;
  modelUsed: string | null;
  createdAt: Date;
}

function rowToRecord(row: LogRow): AgentExecutionLogRecord {
  return {
    id: row.id,
    executionId: row.executionId,
    correlationId: row.correlationId,
    agentRole: row.agentRole,
    prompt: row.prompt,
    llmResponse: row.llmResponse,
    resultStatus: row.resultStatus,
    // postgres returns TEXT[] as a JS array directly; normalise null →
    // empty array so consumers can call `.map` without guarding.
    artifactPaths: row.artifactPaths ?? [],
    signalTypes: row.signalTypes ?? [],
    errorMessage: row.errorMessage,
    modelUsed: row.modelUsed,
    createdAt: row.createdAt,
  };
}

export class PostgresAgentExecutionLogRepository implements AgentExecutionLogRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async save(
    log: Omit<AgentExecutionLogRecord, 'id' | 'createdAt'>,
  ): Promise<AgentExecutionLogRecord> {
    const db = getDb();
    const [row] = await db<LogRow[]>`
      INSERT INTO agent_execution_logs (
        execution_id, correlation_id, agent_role,
        prompt, llm_response, result_status,
        artifact_paths, signal_types, error_message,
        model_used
      ) VALUES (
        ${log.executionId},
        ${log.correlationId},
        ${log.agentRole},
        ${log.prompt},
        ${log.llmResponse},
        ${log.resultStatus},
        ${log.artifactPaths},
        ${log.signalTypes},
        ${log.errorMessage},
        ${log.modelUsed}
      )
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async findByExecutionId(executionId: string): Promise<AgentExecutionLogRecord | null> {
    const db = getDb();
    const rows = await db<LogRow[]>`
      SELECT * FROM agent_execution_logs WHERE execution_id = ${executionId} LIMIT 1
    `;
    return rows.length ? rowToRecord(rows[0]!) : null;
  }

  async findByCorrelationId(correlationId: string): Promise<AgentExecutionLogRecord[]> {
    const db = getDb();
    const rows = await db<LogRow[]>`
      SELECT * FROM agent_execution_logs
       WHERE correlation_id = ${correlationId}
       ORDER BY created_at
    `;
    return rows.map(rowToRecord);
  }
}
