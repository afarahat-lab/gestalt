/**
 * Platform template repository — SQL Server stub.
 */

import type {
  PlatformTemplateRepository, PlatformTemplateRecord, PlatformTemplateSummary,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql PlatformTemplateRepository: not implemented');
};

export class MssqlPlatformTemplateRepository implements PlatformTemplateRepository {
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
