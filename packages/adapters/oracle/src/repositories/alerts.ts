/**
 * Alert repository — Oracle stub.
 *
 * Placeholder so adding a method to `AlertRepository` in core forces a
 * build break here rather than at runtime.
 */

import type { AlertRepository, AlertRecord } from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle AlertRepository: not implemented');
};

export class OracleAlertRepository implements AlertRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(
    _alert: Omit<AlertRecord, 'id' | 'createdAt' | 'acknowledgedAt' | 'acknowledgedBy'>,
  ): Promise<AlertRecord> { return notImplemented(); }
  async findById(_id: string): Promise<AlertRecord | null> { return notImplemented(); }
  async findUnacknowledged(): Promise<AlertRecord[]> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<AlertRecord[]> { return notImplemented(); }
  async acknowledge(_id: string, _userId: string): Promise<AlertRecord> { return notImplemented(); }
}
