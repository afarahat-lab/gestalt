/**
 * Platform groups repository — Oracle stub (Brief 1, migration 018).
 */

import type {
  PlatformGroupRepository, PlatformGroupRecord,
  GroupMemberWithUser, GroupProjectWithProject,
  EffectiveProjectMembership,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle PlatformGroupRepository: not implemented');
};

export class OraclePlatformGroupRepository implements PlatformGroupRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async list(): Promise<PlatformGroupRecord[]> { return notImplemented(); }
  async findById(_id: string): Promise<PlatformGroupRecord | null> { return notImplemented(); }
  async findByName(_name: string): Promise<PlatformGroupRecord | null> { return notImplemented(); }
  async create(_p: { name: string; description?: string | null; createdBy: string }): Promise<PlatformGroupRecord> { return notImplemented(); }
  async update(_id: string, _p: { name?: string; description?: string | null }): Promise<PlatformGroupRecord> { return notImplemented(); }
  async delete(_id: string): Promise<void> { return notImplemented(); }
  async addMember(_g: string, _u: string, _b: string): Promise<void> { return notImplemented(); }
  async removeMember(_g: string, _u: string): Promise<void> { return notImplemented(); }
  async listMembers(_g: string): Promise<GroupMemberWithUser[]> { return notImplemented(); }
  async assignToProject(_g: string, _p: string, _r: 'project-admin' | 'editor' | 'reader', _b: string): Promise<void> { return notImplemented(); }
  async removeFromProject(_g: string, _p: string): Promise<void> { return notImplemented(); }
  async listProjectAssignments(_g: string): Promise<GroupProjectWithProject[]> { return notImplemented(); }
  async getEffectiveMemberships(_u: string): Promise<EffectiveProjectMembership[]> { return notImplemented(); }
}
