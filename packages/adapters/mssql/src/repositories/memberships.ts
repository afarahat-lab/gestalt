/**
 * Project membership repository — SQL Server stub.
 *
 * Placeholder so that adding a method to `ProjectMembershipRepository`
 * in core forces a build break here rather than at runtime. Every
 * method throws; when SQL Server support is built, replace with a real
 * implementation.
 */

import type {
  ProjectMembershipRepository, ProjectMembershipRecord, ProjectRole,
} from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql ProjectMembershipRepository: not implemented');
};

export class MssqlProjectMembershipRepository implements ProjectMembershipRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async addMember(_params: { userId: string; projectId: string; role: ProjectRole; assignedBy: string }): Promise<ProjectMembershipRecord> { return notImplemented(); }
  async updateRole(_userId: string, _projectId: string, _role: ProjectRole): Promise<ProjectMembershipRecord> { return notImplemented(); }
  async removeMember(_userId: string, _projectId: string): Promise<void> { return notImplemented(); }
  async findByProject(_projectId: string): Promise<ProjectMembershipRecord[]> { return notImplemented(); }
  async findByUser(_userId: string): Promise<ProjectMembershipRecord[]> { return notImplemented(); }
  async findMembership(_userId: string, _projectId: string): Promise<ProjectMembershipRecord | null> { return notImplemented(); }
  async countAdmins(_projectId: string): Promise<number> { return notImplemented(); }
  async countByProject(_projectId: string): Promise<number> { return notImplemented(); }
  async deleteAllForProject(_projectId: string): Promise<number> { return notImplemented(); }
}
