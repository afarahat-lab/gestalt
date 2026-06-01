/**
 * @gestalt/adapter-postgres
 *
 * PostgreSQL adapter — implements the full RepositoryRegistry.
 * Called once at server startup: createPostgresAdapter(url) → setRepositories(adapter)
 */

import type { RepositoryRegistry } from '@gestalt/core';
import { createContextLogger } from '@gestalt/core';
import { createDb, closeDb, pingDb } from './client';
import { PostgresIntentRepository } from './repositories/intents';
import { PostgresAuditRepository } from './repositories/audit';
import { PostgresUserRepository } from './repositories/users';
import { PostgresLocalAuthRepository } from './repositories/local-auth';
import { PostgresAgentExecutionRepository } from './repositories/executions';
import { PostgresArtifactRepository } from './repositories/artifacts';
import { PostgresSignalRepository } from './repositories/signals';
import { PostgresProjectRepository } from './repositories/projects';
import { PostgresDeploymentEventRepository } from './repositories/deployment-events';
import { PostgresMaintenanceRunRepository } from './repositories/maintenance-runs';
import { PostgresFindingAttemptRepository } from './repositories/finding-attempts';
import { PostgresAlertRepository } from './repositories/alerts';
import { PostgresAgentExecutionLogRepository } from './repositories/execution-logs';
import { PostgresProjectMembershipRepository } from './repositories/memberships';
import { PostgresInterventionRepository } from './repositories/interventions';
import { runMigrations } from './migrations/runner';

export { closeDb, pingDb };

const log = createContextLogger({ module: 'adapter-postgres' });

export async function createPostgresAdapter(databaseUrl: string): Promise<RepositoryRegistry> {
  createDb(databaseUrl);

  const healthy = await pingDb();
  if (!healthy) throw new Error('PostgreSQL health check failed');

  await runMigrations();
  log.info('PostgreSQL adapter ready');

  return {
    intents:    new PostgresIntentRepository(),
    executions: new PostgresAgentExecutionRepository(),
    artifacts:  new PostgresArtifactRepository(),
    signals:    new PostgresSignalRepository(),
    audit:      new PostgresAuditRepository(),
    users:      new PostgresUserRepository(),
    localAuth:  new PostgresLocalAuthRepository(),
    projects:   new PostgresProjectRepository(),
    deploymentEvents: new PostgresDeploymentEventRepository(),
    maintenanceRuns:  new PostgresMaintenanceRunRepository(),
    findingAttempts:  new PostgresFindingAttemptRepository(),
    alerts:           new PostgresAlertRepository(),
    executionLogs:    new PostgresAgentExecutionLogRepository(),
    memberships:      new PostgresProjectMembershipRepository(),
    interventions:    new PostgresInterventionRepository(),
  };
}
