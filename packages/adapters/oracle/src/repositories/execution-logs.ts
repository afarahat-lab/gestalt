/**
 * Agent execution log repository — Oracle stub.
 *
 * Throw-stub so adding methods to `AgentExecutionLogRepository` in core
 * forces a build break here. Same pattern as the alerts /
 * deployment-events / maintenance-runs / projects stubs.
 */

import type {
  AgentExecutionLogRepository, AgentExecutionLogRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle AgentExecutionLogRepository: not implemented');
};

export class OracleAgentExecutionLogRepository implements AgentExecutionLogRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async save(
    _log: Omit<AgentExecutionLogRecord, 'id' | 'createdAt'>,
  ): Promise<AgentExecutionLogRecord> { return notImplemented(); }
  async findByExecutionId(_executionId: string): Promise<AgentExecutionLogRecord | null> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<AgentExecutionLogRecord[]> { return notImplemented(); }
}
