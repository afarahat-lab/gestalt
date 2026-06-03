/**
 * gestalt platform llms — platform-admin commands for the LLM registry.
 *
 *   gestalt platform llms list                — table of registered LLMs
 *   gestalt platform llms add                 — interactive add
 *   gestalt platform llms set-default <name>  — promote one LLM to default
 *   gestalt platform llms remove <name>       — delete one LLM
 *   gestalt platform llms test <name>         — send a `hello` to the endpoint
 *
 * The actual API key VALUE is never read by this CLI — operators set
 * `apiKeyEnv` and the SERVER reads `process.env[apiKeyEnv]` at LLM
 * call time. This means the operator must edit the server's `.env`
 * (or equivalent secret-management mechanism) before adding the LLM
 * so the `test` command can verify reachability.
 */

import { GestaltApiClient, type PlatformLLM } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, prompt, confirm,
} from '../ui/prompts';

interface BaseOptions { server?: string }

const VALID_PROVIDERS = new Set(['openai', 'azure-openai', 'anthropic', 'ollama', 'custom']);

const PROVIDER_BASE_URLS: Record<string, string> = {
  'openai':       'https://api.openai.com/v1',
  'azure-openai': '',  // operator fills in the deployment URL
  'anthropic':    'https://api.anthropic.com/v1',
  'ollama':       'http://localhost:11434/v1',
  'custom':       '',
};

// ─── llms list ───────────────────────────────────────────────────────────────

export async function platformLlmsListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformLlms();
    blank();
    console.log(c.bold(`Platform LLMs (${res.data.length})`));
    divider();
    if (res.data.length === 0) {
      console.log(c.dim('No LLMs registered.'));
      blank();
      return;
    }
    printTable(
      res.data.map((l) => ({
        name:     l.isDefault ? c.success(`★ ${l.name}`) : `  ${l.name}`,
        provider: l.provider,
        model:    l.modelString,
        baseUrl:  l.baseUrl,
        envVar:   l.apiKeyEnv,
      })),
      [
        { key: 'name',     header: 'Name',     width: 28 },
        { key: 'provider', header: 'Provider', width: 14 },
        { key: 'model',    header: 'Model',    width: 24 },
        { key: 'baseUrl',  header: 'Base URL', width: 38 },
        { key: 'envVar',   header: 'Env var',  width: 22 },
      ],
    );
    blank();
    console.log(c.dim('★ = current default. Use `gestalt platform llms set-default <name>` to change.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list LLMs');
  }
}

// ─── llms add ────────────────────────────────────────────────────────────────

export async function platformLlmsAddCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;

  blank();
  console.log(c.bold('Register a platform LLM'));
  divider();
  const name = (await prompt('Display name (e.g. "GPT-4o-mini"):')).trim();
  if (!name) { console.log(c.error('Name required')); process.exit(1); }

  let provider = (await prompt(`Provider (${[...VALID_PROVIDERS].join(' | ')}):`)).trim();
  if (!VALID_PROVIDERS.has(provider)) {
    console.log(c.error(`Invalid provider '${provider}'`));
    process.exit(1);
  }

  const modelString = (await prompt('Model string (the API model name, e.g. "gpt-4o-mini"):')).trim();
  if (!modelString) { console.log(c.error('Model string required')); process.exit(1); }

  const baseUrlPrefilled = PROVIDER_BASE_URLS[provider] ?? '';
  const baseUrlPrompt = baseUrlPrefilled
    ? `Base URL (default ${baseUrlPrefilled}):`
    : 'Base URL:';
  const baseUrlRaw = (await prompt(baseUrlPrompt)).trim();
  const baseUrl = baseUrlRaw || baseUrlPrefilled;
  if (!baseUrl) { console.log(c.error('Base URL required')); process.exit(1); }

  const apiKeyEnv = (await prompt('API key env var name (e.g. OPENAI_API_KEY):')).trim();
  if (!apiKeyEnv) { console.log(c.error('apiKeyEnv required')); process.exit(1); }

  const description = (await prompt('Description (optional):')).trim() || null;
  const setDefault = await confirm('Set as the platform default?');

  try {
    const res = await client.createPlatformLlm({
      name, provider, modelString, baseUrl, apiKeyEnv,
      isDefault: setDefault,
      description,
    });
    blank();
    console.log(c.success(`✓ LLM registered: ${res.data.name}`));
    if (res.data.isDefault) console.log(c.dim('  Set as platform default.'));
    console.log(c.dim(`  Make sure the server has ${apiKeyEnv} set in its .env or secret manager.`));
    console.log(c.dim(`  Verify reachability: gestalt platform llms test "${res.data.name}"`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to register LLM');
  }
}

// ─── llms set-default ────────────────────────────────────────────────────────

export async function platformLlmsSetDefaultCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const llm = await resolveLlmByName(client, name);
    if (llm.isDefault) {
      console.log(c.dim(`${llm.name} is already the default.`));
      return;
    }
    await client.updatePlatformLlm(llm.id, { isDefault: true });
    blank();
    console.log(c.success(`✓ ${llm.name} set as platform default`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to set default for ${name}`);
  }
}

// ─── llms remove ─────────────────────────────────────────────────────────────

export async function platformLlmsRemoveCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const llm = await resolveLlmByName(client, name);
    if (!await confirm(`Remove LLM '${llm.name}'?`)) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.deletePlatformLlm(llm.id);
    blank();
    console.log(c.success(`✓ LLM removed: ${llm.name}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove LLM ${name}`);
  }
}

// ─── llms test ───────────────────────────────────────────────────────────────

export async function platformLlmsTestCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const llm = await resolveLlmByName(client, name);
    blank();
    console.log(c.dim(`Testing ${llm.name} at ${llm.baseUrl} ...`));
    const res = await client.testPlatformLlm(llm.id);
    if (res.data.ok) {
      console.log(c.success(`✓ ${llm.name} reachable (${res.data.latencyMs}ms)`));
    } else {
      console.log(c.error(`✗ ${llm.name} unreachable: ${res.data.error}`));
      console.log(c.dim(`  Check ${llm.apiKeyEnv} is set in the server .env and the base URL is correct.`));
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to test LLM ${name}`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface CommandContext {
  client: GestaltApiClient;
  serverUrl: string;
}

async function openClient(options: BaseOptions): Promise<CommandContext | null> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  return { client: new GestaltApiClient({ serverUrl, token: config.token }), serverUrl };
}

async function resolveLlmByName(client: GestaltApiClient, name: string): Promise<PlatformLLM> {
  const res = await client.listPlatformLlms();
  const match = res.data.find((l) => l.name === name);
  if (!match) {
    console.log(c.error(`No LLM named '${name}'. Run: gestalt platform llms list`));
    process.exit(1);
  }
  return match;
}

function handleErr(err: unknown, serverUrl: string, label: string): never {
  if (isConnectivityError(err)) {
    printConnectionError(serverUrl);
  } else {
    console.log(c.error(`${label}: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(1);
}
