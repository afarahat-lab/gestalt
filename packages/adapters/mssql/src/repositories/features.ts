/**
 * Feature repository — SQL Server stub.
 *
 * Placeholder so adding a method to `FeatureRepository` in core forces
 * a build break here rather than at runtime. Same pattern as the other
 * MSSQL stubs.
 */

import type {
  FeatureRepository, FeatureRecord, FeaturePhaseRecord,
  FeaturePlanLogRecord, FeatureStatus, PhaseStatus,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql FeatureRepository: not implemented');
};

export class MssqlFeatureRepository implements FeatureRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(
    _feature: Omit<FeatureRecord, 'createdAt' | 'updatedAt' | 'architecture' | 'phaseCount' | 'currentPhase' | 'status'>,
  ): Promise<FeatureRecord> { return notImplemented(); }
  async findById(_id: string): Promise<FeatureRecord | null> { return notImplemented(); }
  async listByProject(_projectId: string): Promise<FeatureRecord[]> { return notImplemented(); }
  async updateStatus(_id: string, _status: FeatureStatus): Promise<FeatureRecord> { return notImplemented(); }
  async saveArchitectureAndPlan(
    _id: string,
    _params: { architecture: string; phaseCount: number },
  ): Promise<FeatureRecord> { return notImplemented(); }
  async setCurrentPhase(_id: string, _phaseIndex: number): Promise<FeatureRecord> { return notImplemented(); }
  async createPhase(
    _phase: Omit<FeaturePhaseRecord, 'createdAt' | 'updatedAt' | 'status' | 'intentId' | 'result' | 'retryCount'>,
  ): Promise<FeaturePhaseRecord> { return notImplemented(); }
  async findPhaseByIndex(_featureId: string, _phaseIndex: number): Promise<FeaturePhaseRecord | null> { return notImplemented(); }
  async listPhases(_featureId: string): Promise<FeaturePhaseRecord[]> { return notImplemented(); }
  async updatePhaseIntent(_phaseId: string, _intentId: string): Promise<FeaturePhaseRecord> { return notImplemented(); }
  async updatePhaseStatus(_phaseId: string, _status: PhaseStatus): Promise<FeaturePhaseRecord> { return notImplemented(); }
  async savePhaseResult(_phaseId: string, _result: unknown): Promise<FeaturePhaseRecord> { return notImplemented(); }
  async findPhaseByIntent(_intentId: string): Promise<FeaturePhaseRecord | null> { return notImplemented(); }
  async incrementPhaseRetry(_phaseId: string): Promise<number> { return notImplemented(); }
  async appendLog(
    _entry: Omit<FeaturePlanLogRecord, 'id' | 'createdAt'>,
  ): Promise<FeaturePlanLogRecord> { return notImplemented(); }
  async listLog(_featureId: string): Promise<FeaturePlanLogRecord[]> { return notImplemented(); }
}
