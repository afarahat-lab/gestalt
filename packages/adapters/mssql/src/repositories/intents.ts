/**
 * Intent repository — SQL Server stub.
 *
 * Placeholder so adding a method to `IntentRepository` in core forces a
 * build break here rather than at runtime. Same pattern as the alerts /
 * deployment-events / maintenance-runs / projects stubs.
 */

import type {
  IntentRepository, IntentRecord, IntentStatus,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql IntentRepository: not implemented');
};

export class MssqlIntentRepository implements IntentRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(
    _intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt' | 'clarification'>,
  ): Promise<IntentRecord> { return notImplemented(); }
  async findById(_id: string): Promise<IntentRecord | null> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<IntentRecord | null> { return notImplemented(); }
  async updateStatus(_id: string, _status: IntentStatus): Promise<IntentRecord> { return notImplemented(); }
  async saveClarification(_id: string, _clarification: string): Promise<IntentRecord> { return notImplemented(); }
  async list(_params: {
    projectId: string;
    status?: IntentStatus;
    limit: number;
    offset: number;
  }): Promise<{ records: IntentRecord[]; total: number }> { return notImplemented(); }
  async listAll(_params: {
    status?: IntentStatus;
    limit: number;
    offset: number;
  }): Promise<{ records: IntentRecord[]; total: number }> { return notImplemented(); }
}
