/**
 * Platform template repository — Oracle stub.
 * Placeholder so adding a method to `PlatformTemplateRepository` in
 * core forces a build break here rather than at runtime.
 */

import type {
  PlatformTemplateRepository, PlatformTemplateRecord, PlatformTemplateSummary,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle PlatformTemplateRepository: not implemented');
};

export class OraclePlatformTemplateRepository implements PlatformTemplateRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<PlatformTemplateSummary[]> { return notImplemented(); }
  async findById(_id: string): Promise<PlatformTemplateRecord | null> { return notImplemented(); }
  async findBySlug(_slug: string): Promise<PlatformTemplateRecord | null> { return notImplemented(); }
  async findDefault(): Promise<PlatformTemplateRecord | null> { return notImplemented(); }
  async create(_t: Omit<PlatformTemplateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformTemplateRecord> { return notImplemented(); }
  async update(_id: string, _updates: Partial<Omit<PlatformTemplateRecord, 'id' | 'createdAt'>>): Promise<PlatformTemplateRecord> { return notImplemented(); }
  async setDefault(_id: string): Promise<void> { return notImplemented(); }
  async delete(_id: string): Promise<void> { return notImplemented(); }
}
