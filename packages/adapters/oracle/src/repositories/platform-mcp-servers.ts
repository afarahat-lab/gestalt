/**
 * Platform MCP server repository — Oracle stub.
 */

import type {
  PlatformMcpServerRepository, PlatformMcpServerRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle PlatformMcpServerRepository: not implemented');
};

export class OraclePlatformMcpServerRepository implements PlatformMcpServerRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<PlatformMcpServerRecord[]> { return notImplemented(); }
  async listEnabled(): Promise<PlatformMcpServerRecord[]> { return notImplemented(); }
  async findById(_id: string): Promise<PlatformMcpServerRecord | null> { return notImplemented(); }
  async findByName(_name: string): Promise<PlatformMcpServerRecord | null> { return notImplemented(); }
  async create(_s: Omit<PlatformMcpServerRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformMcpServerRecord> { return notImplemented(); }
  async update(_id: string, _updates: Partial<Omit<PlatformMcpServerRecord, 'id' | 'createdAt'>>): Promise<PlatformMcpServerRecord> { return notImplemented(); }
  async delete(_id: string): Promise<void> { return notImplemented(); }
}
