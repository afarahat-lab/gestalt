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
  };
}
