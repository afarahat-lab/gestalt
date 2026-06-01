/**
 * Intervention repository — Oracle stub (ADR-021).
 *
 * Placeholder so that adding a method to `InterventionRepository` in
 * core forces a build break here rather than at runtime. Every method
 * throws; when Oracle support is built, replace with a real impl.
 */

import type {
  InterventionRepository, InterventionRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle InterventionRepository: not implemented');
};

export class OracleInterventionRepository implements InterventionRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_intervention: Omit<InterventionRecord, 'id' | 'createdAt'>): Promise<InterventionRecord> { return notImplemented(); }
  async findByIntentId(_intentId: string): Promise<InterventionRecord[]> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<InterventionRecord[]> { return notImplemented(); }
}
