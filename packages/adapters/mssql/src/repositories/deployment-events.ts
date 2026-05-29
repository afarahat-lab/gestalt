/**
 * Deployment event repository — SQL Server stub.
 *
 * Placeholder so adding a method to `DeploymentEventRepository` in core
 * forces a build break here rather than at runtime. Every method
 * throws; when SQL Server support is built, replace with a real
 * implementation.
 */

import type { DeploymentEventRepository, DeploymentEventRecord } from '@gestalt/core';

const notImplemented = (): never => {
  throw new Error('@gestalt/adapter-mssql DeploymentEventRepository: not implemented');
};

export class MssqlDeploymentEventRepository implements DeploymentEventRepository {
  async healthCheck(): Promise<boolean> { return notImplemented(); }
  async append(_event: Omit<DeploymentEventRecord, 'id' | 'createdAt'>): Promise<DeploymentEventRecord> { return notImplemented(); }
  async findByCorrelationId(_correlationId: string): Promise<DeploymentEventRecord[]> { return notImplemented(); }
  async findStagingPromotion(_correlationId: string): Promise<DeploymentEventRecord | null> { return notImplemented(); }
}
