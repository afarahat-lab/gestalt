/**
 * Server entry point.
 *
 * Startup sequence:
 *   1. Load and validate config
 *   2. Initialise database (run migrations)
 *   3. Set repository registry
 *   4. Initialise LLM client
 *   5. Create auth manager
 *   6. Start generate-layer orchestrator worker
 *   7. Start quality-gate worker
 *   8. Start deploy worker
 *   9. Create and start Fastify app
 *   10. Register graceful shutdown
 */

import { loadConfig, createLLMClient, setRepositories, createContextLogger } from '@gestalt/core';
import { createPostgresAdapter, closeDb } from '@gestalt/adapter-postgres';
import { startOrchestratorWorker } from '@gestalt/agents-generate';
import { startGateWorker } from '@gestalt/agents-quality-gate';
import { startDeployWorker } from '@gestalt/agents-deploy';
import { createApp } from './app';
import { createAuthManager } from './auth/auth-manager';
import { loadIdentityConfig } from './auth/config-loader';

const log = createContextLogger({ module: 'server' });

export async function startServer(): Promise<void> {
  log.info('Gestalt server starting...');

  // 1. Config
  const config = loadConfig();
  log.info({ nodeEnv: config.server.nodeEnv, port: config.server.port }, 'Config loaded');

  // 2 + 3. Database
  log.info({ adapter: config.database.adapter }, 'Initialising database...');
  if (config.database.adapter === 'postgres') {
    const adapter = await createPostgresAdapter(config.database.url);
    setRepositories(adapter);
  } else {
    throw new Error(
      `Database adapter '${config.database.adapter}' not yet implemented. ` +
      `Use 'postgres' for now.`,
    );
  }
  log.info('Database ready');

  // 4. LLM client
  createLLMClient(config.llm);
  log.info({ model: config.llm.model }, 'LLM client ready');

  // 5. Auth manager
  const identityConfig = await loadIdentityConfig();
  const authManager = await createAuthManager(identityConfig, {
    jwtSecret: config.auth.jwtSecret,
    sessionTtlMinutes: config.auth.sessionTtlMinutes,
  });
  log.info('Auth manager ready');

  // 6. Generate-layer orchestrator worker (drains bull:gestalt-generate:*)
  startOrchestratorWorker(config.queue);
  log.info('Orchestrator worker started');

  // 7. Quality-gate worker (drains bull:gestalt-gate:*)
  startGateWorker(config.queue);
  log.info('Quality-gate worker started');

  // 8. Deploy worker (drains bull:gestalt-deploy:* — pr/pipeline/promotion)
  startDeployWorker(config.queue);
  log.info('Deploy worker started');

  // 9. Fastify app
  const app = await createApp(config, authManager);

  await app.listen({
    port: config.server.port,
    host: '0.0.0.0',
  });

  log.info(
    { port: config.server.port, baseUrl: config.server.baseUrl },
    'Gestalt server started',
  );

  // 7. Graceful shutdown
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      log.info({ signal }, 'Shutdown signal received');
      await app.close();
      await closeDb();
      log.info('Gestalt server stopped');
      process.exit(0);
    });
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
