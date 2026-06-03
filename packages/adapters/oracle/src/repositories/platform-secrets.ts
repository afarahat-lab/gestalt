/**
 * Platform secrets repository — Oracle stub.
 *
 * Placeholder so adding a method to `PlatformSecretRepository` in core
 * forces a build break here rather than at runtime.
 */

import type {
  PlatformSecretRepository, PlatformSecretRecord, PlatformSecretSummary,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle PlatformSecretRepository: not implemented');
};

export class OraclePlatformSecretRepository implements PlatformSecretRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_params: {
    name: string; description?: string | null;
    encrypted: string; iv: string; authTag: string; createdBy: string;
  }): Promise<PlatformSecretRecord> { return notImplemented(); }
  async update(_id: string, _params: {
    name?: string; description?: string | null;
    encrypted?: string; iv?: string; authTag?: string;
  }): Promise<PlatformSecretRecord> { return notImplemented(); }
  async findById(_id: string): Promise<PlatformSecretRecord | null> { return notImplemented(); }
  async findByName(_name: string): Promise<PlatformSecretRecord | null> { return notImplemented(); }
  async list(): Promise<PlatformSecretSummary[]> { return notImplemented(); }
  async delete(_id: string): Promise<void> { return notImplemented(); }
  async findReferencingLlms(_secretId: string): Promise<Array<{ id: string; name: string }>> { return notImplemented(); }
}
