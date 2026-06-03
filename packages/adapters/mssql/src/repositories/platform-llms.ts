/**
 * Platform LLM repository — SQL Server stub.
 *
 * Placeholder so adding a method to `PlatformLLMRepository` in core
 * forces a build break here rather than at runtime.
 */

import type {
  PlatformLLMRepository, PlatformLLMRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql PlatformLLMRepository: not implemented');
};

export class MssqlPlatformLLMRepository implements PlatformLLMRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<PlatformLLMRecord[]> { return notImplemented(); }
  async findById(_id: string): Promise<PlatformLLMRecord | null> { return notImplemented(); }
  async findByName(_name: string): Promise<PlatformLLMRecord | null> { return notImplemented(); }
  async findDefault(): Promise<PlatformLLMRecord | null> { return notImplemented(); }
  async findByModelString(_modelString: string): Promise<PlatformLLMRecord | null> { return notImplemented(); }
  async create(_llm: Omit<PlatformLLMRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformLLMRecord> { return notImplemented(); }
  async update(_id: string, _updates: Partial<Omit<PlatformLLMRecord, 'id' | 'createdAt'>>): Promise<PlatformLLMRecord> { return notImplemented(); }
  async delete(_id: string): Promise<void> { return notImplemented(); }
  async setDefault(_id: string): Promise<PlatformLLMRecord> { return notImplemented(); }
  async count(): Promise<number> { return notImplemented(); }
}
