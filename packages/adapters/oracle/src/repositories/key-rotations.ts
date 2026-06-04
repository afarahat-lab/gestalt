/**
 * Key rotations repository — Oracle stub.
 *
 * Placeholder so adding a method to `KeyRotationRepository` in core
 * forces a build break here rather than at runtime.
 */

import type { KeyRotationRepository, KeyRotationRecord } from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle KeyRotationRepository: not implemented');
};

export class OracleKeyRotationRepository implements KeyRotationRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_params: { rotatedBy: string; secretCount: number }): Promise<KeyRotationRecord> { return notImplemented(); }
  async findLatest(): Promise<KeyRotationRecord | null> { return notImplemented(); }
}
