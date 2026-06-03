/**
 * Self-healing config repository — Oracle stub (migration 020).
 *
 * Placeholder so adding a method to `SelfHealingConfigRepository` in
 * core forces a build break here rather than at runtime. Same
 * pattern as the alerts / platform-llms / platform-groups stubs.
 */

import type {
  SelfHealingConfigRepository, SelfHealingConfigRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle SelfHealingConfigRepository: not implemented');
};

export class OracleSelfHealingConfigRepository implements SelfHealingConfigRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<SelfHealingConfigRecord[]> { return notImplemented(); }
  async findByType(_failureType: string): Promise<SelfHealingConfigRecord | null> { return notImplemented(); }
  async update(
    _failureType: string,
    _params: {
      maxAttempts?: number;
      confidenceThreshold?: 'high' | 'medium' | 'low';
      autoResolveAlerts?: boolean;
      enabled?: boolean;
      updatedBy: string;
    },
  ): Promise<SelfHealingConfigRecord> { return notImplemented(); }
}
