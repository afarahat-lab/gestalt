/**
 * Intent repository — Oracle stub.
 *
 * Placeholder so adding a method to `IntentRepository` in core forces a
 * build break here rather than at runtime. Same pattern as the alerts /
 * deployment-events / maintenance-runs / projects stubs.
 */

import type {
  IntentRepository, IntentRecord, IntentStatus, ResumeContext,
  IntentListFilters,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle IntentRepository: not implemented');
};

export class OracleIntentRepository implements IntentRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(
    _intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt' | 'clarification' | 'branchName' | 'prNumber' | 'prUrl' | 'attemptCount' | 'lastResumeContext' | 'parentIntentId' | 'onSuccessDispatch'> & { parentIntentId?: string | null },
  ): Promise<IntentRecord> { return notImplemented(); }
  async findById(_id: string): Promise<IntentRecord | null> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<IntentRecord | null> { return notImplemented(); }
  async updateStatus(_id: string, _status: IntentStatus): Promise<IntentRecord> { return notImplemented(); }
  async saveClarification(_id: string, _clarification: string): Promise<IntentRecord> { return notImplemented(); }
  async list(_params: IntentListFilters & { projectId: string }): Promise<{ records: IntentRecord[]; total: number }> { return notImplemented(); }
  async listAll(_params: IntentListFilters): Promise<{ records: IntentRecord[]; total: number }> { return notImplemented(); }
  async listForProjects(_projectIds: string[], _filters: IntentListFilters): Promise<{ records: IntentRecord[]; total: number }> { return notImplemented(); }
  async countByProject(_projectId: string): Promise<number> { return notImplemented(); }
  async countActiveByProject(_projectId: string): Promise<number> { return notImplemented(); }
  async findLatestByProject(_projectId: string): Promise<IntentRecord | null> { return notImplemented(); }
  async saveBranchInfo(_id: string, _params: { branchName: string; prNumber?: number | null; prUrl?: string | null }): Promise<IntentRecord> { return notImplemented(); }
  async saveResumeContext(_id: string, _context: ResumeContext): Promise<void> { return notImplemented(); }
  async saveOnSuccessDispatch(_id: string, _dispatch: Record<string, unknown> | null): Promise<void> { return notImplemented(); }
  async incrementAttemptCount(_id: string): Promise<number> { return notImplemented(); }
}
