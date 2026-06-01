/**
 * Project membership repository — Oracle stub.
 *
 * Placeholder so that adding a method to `ProjectMembershipRepository`
 * in core forces a build break here rather than at runtime. Every
 * method throws; when Oracle support is built, replace with a real
 * implementation.
 */

import type {
  ProjectMembershipRepository, ProjectMembershipRecord, ProjectRole,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-oracle ProjectMembershipRepository: not implemented');
};

export class OracleProjectMembershipRepository implements ProjectMembershipRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async addMember(_params: { userId: string; projectId: string; role: ProjectRole; assignedBy: string }): Promise<ProjectMembershipRecord> { return notImplemented(); }
  async updateRole(_userId: string, _projectId: string, _role: ProjectRole): Promise<ProjectMembershipRecord> { return notImplemented(); }
  async removeMember(_userId: string, _projectId: string): Promise<void> { return notImplemented(); }
  async findByProject(_projectId: string): Promise<ProjectMembershipRecord[]> { return notImplemented(); }
  async findByUser(_userId: string): Promise<ProjectMembershipRecord[]> { return notImplemented(); }
  async findMembership(_userId: string, _projectId: string): Promise<ProjectMembershipRecord | null> { return notImplemented(); }
  async countAdmins(_projectId: string): Promise<number> { return notImplemented(); }
}
