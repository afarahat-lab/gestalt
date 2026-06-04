/**
 * Project repository — SQL Server stub.
 *
 * Placeholder so that adding a method to `ProjectRepository` in core forces
 * a build break here rather than at runtime. Every method throws; when
 * SQL Server support is built, replace with a real implementation.
 */

import type { ProjectRepository, ProjectRecord } from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql ProjectRepository: not implemented');
};

export class MssqlProjectRepository implements ProjectRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async create(_project: Omit<ProjectRecord, 'id' | 'createdAt' | 'gitSecretId'>): Promise<ProjectRecord> { return notImplemented(); }
  async findById(_id: string): Promise<ProjectRecord | null> { return notImplemented(); }
  async findByName(_name: string): Promise<ProjectRecord | null> { return notImplemented(); }
  async list(_userId: string): Promise<ProjectRecord[]> { return notImplemented(); }
  async listAll(): Promise<ProjectRecord[]> { return notImplemented(); }
  async saveCredential(_projectId: string, _token: string): Promise<void> { return notImplemented(); }
  async getCredential(_projectId: string): Promise<string | null> { return notImplemented(); }
  async delete(_projectId: string): Promise<number> { return notImplemented(); }
  async deleteAllCredentials(_projectId: string): Promise<number> { return notImplemented(); }
  async saveGitSecretRef(_projectId: string, _secretId: string | null): Promise<void> { return notImplemented(); }
}
