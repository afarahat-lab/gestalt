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
  loadMasterKey, decryptSecret,
  setPlatformMcpResolver, McpClient,
} from '@gestalt/core';
import { setMasterKey, getMasterKey } from './secrets/index';
import { createPostgresAdapter, closeDb } from '@gestalt/adapter-postgres';
import { startOrchestratorWorker } from '@gestalt/agents-generate';
import { startGateWorker } from '@gestalt/agents-quality-gate';
import { startDeployWorker } from '@gestalt/agents-deploy';
import { startMaintenanceScheduler } from '@gestalt/agents-maintenance';
import { createApp } from './app';
import { createAuthManager } from './auth/auth-manager';
import { loadIdentityConfig } from './auth/config-loader';
import { collectTemplateFileMap, resolveTemplatesDir } from './templates/engine';

const log = createContextLogger({ module: 'server' });

export async function startServer(): Promise<void> {
  log.info('Gestalt server starting...');

  // 1. Config
  const config = loadConfig();
  log.info({ nodeEnv: config.server.nodeEnv, port: config.server.port }, 'Config loaded');

  // 1b. Master key — must load BEFORE any database operation that
  // might touch encrypted material. In production a missing key is a
  // fatal startup error (preventing accidental key rotation that
  // would orphan existing secrets); in dev a fresh key is generated
  // with a loud warning.
  const masterKey = await loadMasterKey();
  setMasterKey(masterKey);
  log.info('Master key loaded');

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
    const apiKey = await resolveLlmApiKey(match);
    return {
      modelString: match.modelString,
      baseUrl: match.baseUrl,
      apiKey,
    };
  });
  log.info('Platform LLM registry resolver wired');

  // 4c. Platform templates (Session 3 — migration 017).
  //
  // Seed the built-in `corporate-ops-web-mobile` template from the
  // on-disk `templates/` directory on first boot. Custom templates are
  // operator-uploaded via the dashboard / CLI; the built-in seed
  // gives a baseline so a fresh deployment can immediately run
  // `gestalt init` without first manually uploading a template.
  await seedBuiltinTemplate();

  // 4d. Platform MCP server resolver (Session 3 — migration 017).
  //
  // `BaseOrchestrator.resolveAgentContext` iterates the enabled
  // server list and calls this resolver per-server to get a ready
  // `McpClient`. Vault decryption happens here so the master key
  // stays inside the server package — `@gestalt/core` only sees
  // the pre-resolved token.
  setPlatformMcpResolver(async (server) => {
    const token = await resolvePlatformMcpToken(server);
    return new McpClient(server.name, server.url, token);
  });
  log.info('Platform MCP server resolver wired');

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
    // Seeded row uses the legacy env-var path; operators can migrate
    // to a vault secret later via the Admin → LLMs → Edit modal or
    // `gestalt platform llms` CLI.
    secretId: null,
    isDefault: true,
    description: 'Seeded from server .env config on first boot',
  });
  log.info(
    { model: llmConfig.model, baseUrl: llmConfig.baseUrl },
    'Seeded default LLM from .env config',
  );
}

/**
 * Resolve a Platform MCP server's bearer token at orchestration
 * time. `secretId` → vault decrypt; null → anonymous connection.
 * Decryption failures log a warning with the server NAME only
 * (never the secret id or key material) and return `undefined`
 * so the client connects unauthenticated — the MCP server's own
 * auth rejection then surfaces in the orchestrator's tool-call
 * logs.
 */
async function resolvePlatformMcpToken(
  server: { name: string; secretId: string | null },
): Promise<string | undefined> {
  if (!server.secretId) return undefined;
  const secret = await getRepositories().platformSecrets.findById(server.secretId);
  if (!secret) {
    log.warn({ serverName: server.name }, 'Platform MCP server references missing vault secret');
    return undefined;
  }
  try {
    return decryptSecret(
      { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
      getMasterKey(),
    );
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), serverName: server.name },
      'Vault decrypt failed for Platform MCP server token',
    );
    return undefined;
  }
}

/**
 * First-boot seed for `platform_templates`. Idempotent: if a row
 * with `slug = 'corporate-ops-web-mobile'` already exists, do
 * nothing. Otherwise read every file under the on-disk
 * `templates/corporate-ops-web-mobile/` tree into a
 * `{ templateRelativePath: content }` map and INSERT a row with
 * `isBuiltin: true, isDefault: true`.
 *
 * Custom templates uploaded via the dashboard / CLI live in the same
 * table; the engine's read path (`loadTemplate` in
 * `templates/engine.ts`) consults DB first and falls back to the
 * on-disk tree only when no DB row matches.
 */
async function seedBuiltinTemplate(): Promise<void> {
  const slug = 'corporate-ops-web-mobile';
  const repo = getRepositories().platformTemplates;
  const existing = await repo.findBySlug(slug);
  if (existing) {
    log.info({ slug }, 'platform_templates already seeded — skipping');
    return;
  }
  try {
    const templatesDir = resolveTemplatesDir();
    const fileMap = await collectTemplateFileMap(templatesDir, slug);
    await repo.create({
      slug,
      name: 'Corporate Ops Web/Mobile',
      description: 'Tier 1 baseline — TypeScript monorepo with a web SPA + mobile shell',
      tier: 'Tier 1',
      version: '0.1.0',
      isDefault: true,
      isBuiltin: true,
      files: fileMap,
      variables: [],
      createdBy: null,
    });
    log.info({ slug, fileCount: Object.keys(fileMap).length }, 'Seeded built-in template');
  } catch (err) {
    log.warn({ err, slug }, 'Failed to seed built-in template — `gestalt init` will use the filesystem fallback');
  }
}

/**
 * Resolve an LLM's API key at call time. `secretId` wins when set
 * (vault decrypt under the master key); otherwise fall back to
 * `process.env[apiKeyEnv]`. Empty string when neither is configured
 * — the LLM call will fail with a 401 from the provider and surface
 * an actionable error in the orchestrator log.
 *
 * Decryption errors (bad master key / corrupt ciphertext) are NOT
 * thrown here — they're logged with the LLM name (NOT the secret
 * id, NOT any key material) and an empty string returned. This lets
 * an operator who loses access to one vault secret keep using
 * OTHER LLMs that decrypt cleanly, instead of the whole platform
 * stalling.
 */
async function resolveLlmApiKey(
  llm: { id: string; name: string; secretId: string | null; apiKeyEnv: string | null },
): Promise<string> {
  if (llm.secretId) {
    const secret = await getRepositories().platformSecrets.findById(llm.secretId);
    if (secret) {
      try {
        return decryptSecret(
          { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
          getMasterKey(),
        );
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), llmName: llm.name },
          'Vault decrypt failed — falling back to apiKeyEnv if set',
        );
      }
    } else {
      log.warn({ llmName: llm.name, secretId: llm.secretId }, 'Vault secret referenced by LLM not found');
    }
  }
  if (llm.apiKeyEnv) return process.env[llm.apiKeyEnv] ?? '';
  return '';
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
