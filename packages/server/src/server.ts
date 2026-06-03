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
 *   9. Start maintenance scheduler (node-cron schedules in-process)
 *   10. Create and start Fastify app
 *   11. Register graceful shutdown
 */

import {
  loadConfig, createLLMClient, setRepositories, createContextLogger,
  setLLMRegistryResolver, getRepositories,
} from '@gestalt/core';
import { createPostgresAdapter, closeDb } from '@gestalt/adapter-postgres';
import { startOrchestratorWorker } from '@gestalt/agents-generate';
import { startGateWorker } from '@gestalt/agents-quality-gate';
import { startDeployWorker } from '@gestalt/agents-deploy';
import { startMaintenanceScheduler } from '@gestalt/agents-maintenance';
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

  // 4b. Platform LLM registry (migration 014)
  //
  // Seed the registry from the loaded .env config on first boot so
  // every Gestalt deployment starts with at least one default LLM.
  // Operators then add additional LLMs via the Platform Admin UI or
  // the `gestalt platform llms add` CLI.
  await seedPlatformLlmsIfEmpty(config.llm);
  // Wire the registry-aware client resolver so `getLLMClientForModel`
  // (used inside BaseLLMAgent) can look up per-LLM baseUrl + apiKeyEnv.
  setLLMRegistryResolver(async (modelString) => {
    const match = await getRepositories().platformLlms.findByModelString(modelString);
    if (!match) return null;
    return {
      modelString: match.modelString,
      baseUrl: match.baseUrl,
      apiKeyEnv: match.apiKeyEnv,
    };
  });
  log.info('Platform LLM registry resolver wired');

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

  // 9. Maintenance scheduler (4 node-cron schedules in-process)
  startMaintenanceScheduler({ queueConfig: config.queue });
  log.info('Maintenance scheduler started');

  // 10. Fastify app
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

/**
 * First-boot seed for `platform_llms`. Idempotent: if the table
 * already has rows, do nothing. Otherwise insert one row mirroring
 * the loaded `.env` LLM config so the registry has at least one
 * default before any agent runs.
 *
 * `apiKeyEnv` is recorded as the literal string `'LLM_API_KEY'` — the
 * env-var name the platform's config loader already reads. The
 * actual key VALUE stays in `process.env` and is never persisted.
 */
async function seedPlatformLlmsIfEmpty(
  llmConfig: { model: string; baseUrl: string },
): Promise<void> {
  const repo = getRepositories().platformLlms;
  const count = await repo.count();
  if (count > 0) {
    log.info({ count }, 'platform_llms already seeded — skipping');
    return;
  }
  await repo.create({
    name: 'Platform default',
    provider: detectProviderFromBaseUrl(llmConfig.baseUrl),
    modelString: llmConfig.model,
    baseUrl: llmConfig.baseUrl,
    apiKeyEnv: 'LLM_API_KEY',
    isDefault: true,
    description: 'Seeded from server .env config on first boot',
  });
  log.info(
    { model: llmConfig.model, baseUrl: llmConfig.baseUrl },
    'Seeded default LLM from .env config',
  );
}

/**
 * Best-effort provider detection from the baseUrl so the seeded row
 * has a meaningful `provider` value (the registry's `provider` field
 * is informational — actual routing is by `model_string`).
 */
function detectProviderFromBaseUrl(baseUrl: string): string {
  if (baseUrl.includes('openai.azure.com')) return 'azure-openai';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  if (baseUrl.includes('api.anthropic.com')) return 'anthropic';
  if (baseUrl.includes('localhost:11434')) return 'ollama';
  return 'custom';
}

// ─── Run ──────────────────────────────────────────────────────────────────────

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
