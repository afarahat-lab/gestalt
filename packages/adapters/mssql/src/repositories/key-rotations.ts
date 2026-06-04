/**
 * Key rotations repository — SQL Server stub.
 *
 * Placeholder so adding a method to `KeyRotationRepository` in core
 * forces a build break here rather than at runtime.
 */

import type { KeyRotationRepository, KeyRotationRecord } from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql KeyRotationRepository: not implemented');
};

export class MssqlKeyRotationRepository implements KeyRotationRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_params: { rotatedBy: string; secretCount: number }): Promise<KeyRotationRecord> { return notImplemented(); }
  async findLatest(): Promise<KeyRotationRecord | null> { return notImplemented(); }
}
