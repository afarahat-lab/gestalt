/**
 * Maintenance run repository — SQL Server stub.
 *
 * Placeholder so adding a method to `MaintenanceRunRepository` in core
 * forces a build break here rather than at runtime.
 */

import type {
  MaintenanceRunRepository, MaintenanceRunRecord, MaintenanceFinding,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql MaintenanceRunRepository: not implemented');
};

export class MssqlMaintenanceRunRepository implements MaintenanceRunRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_run: Omit<MaintenanceRunRecord, 'id' | 'runAt' | 'completedAt'>): Promise<MaintenanceRunRecord> { return notImplemented(); }
  async complete(
    _id: string,
    _result: {
      status: 'completed' | 'failed';
      intentsQueued: number;
      directFixes: number;
      findings: MaintenanceFinding[];
      durationMs: number;
    },
  ): Promise<MaintenanceRunRecord> { return notImplemented(); }
  async list(_params: { projectId?: string; agentRole?: string; limit: number }): Promise<MaintenanceRunRecord[]> { return notImplemented(); }
  async findById(_id: string): Promise<MaintenanceRunRecord | null> { return notImplemented(); }
  async deleteAllForProject(_projectId: string): Promise<number> { return notImplemented(); }
}
