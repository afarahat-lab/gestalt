/**
 * Agent execution log repository — PostgreSQL implementation.
 *
 * One row per `agent_executions` row; persisted by the layer
 * orchestrators (generate / quality-gate / deploy) right before they
 * transition the execution to a terminal state. Read by the dashboard's
 * IntentDetail accordion when an operator clicks an execution row.
 */

import type {
  AgentExecutionLogRepository, AgentExecutionLogRecord, ToolCallLogEntry,
} from '@gestalt/core';
import { getDb } from '../client';
import { parseJsonb } from '../utils';

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
  // postgres.js may return JSONB as a parsed object/array OR as a raw
  // JSON-encoded string; the shared `parseJsonb` helper normalises
  // both. Migration 012 added the column with `DEFAULT '[]'::jsonb`
  // so pre-migration rows + non-LLM agents come back as `[]`.
  toolCalls: unknown;
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
    toolCalls: parseJsonb<ToolCallLogEntry[]>(row.toolCalls, []),
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
    // postgres.js `db.json(...)` is the typed helper that binds the
    // value as a real JSONB value. The `${JSON.stringify(...)}::jsonb`
    // pattern we used to ship looked correct but actually stores the
    // string as a JSONB string scalar (`jsonb_typeof = 'string'`,
    // `data = "[{...}]"`); confirmed empirically against postgres@3.4.
    // See the shared `parseJsonb` helper on the read path — it
    // unwrapped the trap on the way out, which is why the bug went
    // unnoticed at the application level. Switching every JSONB write
    // site to `db.json(...)` makes the column shape correct so direct
    // SQL probes (`jsonb_array_length`, `jsonb_typeof = 'array'`)
    // work.
    const [row] = await db<LogRow[]>`
      INSERT INTO agent_execution_logs (
        execution_id, correlation_id, agent_role,
        prompt, llm_response, result_status,
        artifact_paths, signal_types, error_message,
        model_used, tool_calls
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
        ${log.modelUsed},
        ${db.json((log.toolCalls ?? []) as unknown as Parameters<typeof db.json>[0])}
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
