/**
 * Identity config + role mapping repositories — SQL Server stubs.
 */

import type {
  IdentityConfigRepository, IdentityConfigRecord, IdentityProvider,
  RoleMappingRepository, RoleMappingRecord,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql identity config: not implemented');
};

export class MssqlIdentityConfigRepository implements IdentityConfigRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<IdentityConfigRecord[]> { return notImplemented(); }
  async findByProvider(_provider: IdentityProvider): Promise<IdentityConfigRecord | null> { return notImplemented(); }
  async upsert(_p: { provider: IdentityProvider; enabled: boolean; config: Record<string, unknown>; updatedBy: string }): Promise<IdentityConfigRecord> { return notImplemented(); }
}

export class MssqlRoleMappingRepository implements RoleMappingRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<RoleMappingRecord[]> { return notImplemented(); }
  async add(_p: { groupName: string; platformRole: 'platform-admin' | 'user'; createdBy: string }): Promise<RoleMappingRecord> { return notImplemented(); }
  async remove(_id: string): Promise<void> { return notImplemented(); }
}
