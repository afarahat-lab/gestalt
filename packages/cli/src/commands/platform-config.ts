/**
 * gestalt platform — platform-admin commands.
 *
 *   gestalt platform llms list/add/set-default/remove/test
 *   gestalt platform secrets list/add/rotate/remove        (Session 4)
 *   gestalt platform projects list/delete/create           (Session — project mgmt)
 *
 * Session 4 adds an encrypted secrets vault (migration 015). The
 * actual secret VALUE is read by the CLI via `promptSecret` (hidden
 * TTY input) and POSTed to the server, which encrypts it under the
 * master key before persistence. The value never appears in CLI
 * output, the server log, the audit row, or the database in
 * plaintext.
 *
 * `gestalt platform llms add` now offers a choice of API key source:
 *   (1) select an existing vault secret by name
 *   (2) supply an environment variable name (legacy path; still
 *       supported for operators who prefer `.env` workflows)
 */

import { randomBytes } from 'crypto';
import {
  GestaltApiClient,
  type PlatformLLM, type PlatformSecretSummary,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, prompt, promptSecret, confirm,
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
        shape:    l.apiShape === 'responses' ? c.info('responses') : c.dim('chat-completions'),
        baseUrl:  l.baseUrl,
        // Source — vault precedence; "env: VAR" otherwise.
        source:   l.secretId
                    ? c.info('vault')
                    : (l.apiKeyEnv ? `env: ${l.apiKeyEnv}` : c.warn('(unset)')),
      })),
      [
        { key: 'name',     header: 'Name',      width: 28 },
        { key: 'provider', header: 'Provider',  width: 14 },
        { key: 'model',    header: 'Model',     width: 22 },
        { key: 'shape',    header: 'API shape', width: 18 },
        { key: 'baseUrl',  header: 'Base URL',  width: 34 },
        { key: 'source',   header: 'Key source', width: 22 },
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

  // Session 4 — API key source picker. Vault secret is the
  // recommended path; env var is preserved for back-compat.
  blank();
  console.log(c.bold('API key source'));
  console.log('  (1) Select from vault');
  console.log('  (2) Enter environment variable name');
  const sourceChoice = (await prompt('Choose (1 or 2):')).trim();
  let apiKeyEnv: string | null = null;
  let secretId: string | null = null;
  let chosenSecretName: string | null = null;

  if (sourceChoice === '1') {
    const secrets = await client.listPlatformSecrets().catch(() => ({ data: [] }));
    if (secrets.data.length === 0) {
      console.log(c.error('No vault secrets registered. Add one with `gestalt platform secrets add`, then re-run.'));
      process.exit(1);
    }
    console.log(c.dim('Available secrets:'));
    secrets.data.forEach((s, i) => {
      console.log(`  ${c.dim(`${i + 1}.`)} ${s.name}${s.description ? c.dim(` — ${s.description}`) : ''}`);
    });
    const pickRaw = (await prompt(`Choose (1-${secrets.data.length}):`)).trim();
    const idx = parseInt(pickRaw, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= secrets.data.length) {
      console.log(c.error(`Invalid selection`));
      process.exit(1);
    }
    secretId = secrets.data[idx]!.id;
    chosenSecretName = secrets.data[idx]!.name;
  } else if (sourceChoice === '2') {
    apiKeyEnv = (await prompt('API key env var name (e.g. OPENAI_API_KEY):')).trim();
    if (!apiKeyEnv) { console.log(c.error('apiKeyEnv required')); process.exit(1); }
  } else {
    console.log(c.error('Choose 1 or 2'));
    process.exit(1);
  }

  // Migration 023 — API request shape. Reasoning-class models
  // (gpt-5*, o1, o3) require `max_completion_tokens` + omit
  // `temperature`. Default 'chat-completions' covers everything else.
  blank();
  console.log(c.bold('API request shape'));
  console.log('  (1) chat-completions — legacy max_tokens + temperature (gpt-4o, gpt-3.5, Ollama, vLLM)');
  console.log('  (2) responses        — max_completion_tokens (reasoning: gpt-5*, o1, o3)');
  const shapeChoice = (await prompt('Choose [1]:')).trim() || '1';
  const apiShape: 'chat-completions' | 'responses' =
    shapeChoice === '2' ? 'responses' : 'chat-completions';

  const description = (await prompt('Description (optional):')).trim() || null;
  const setDefault = await confirm('Set as the platform default?');

  try {
    const res = await client.createPlatformLlm({
      name, provider, modelString, baseUrl,
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      ...(secretId ? { secretId } : {}),
      apiShape,
      isDefault: setDefault,
      description,
    });
    blank();
    console.log(c.success(`✓ LLM registered: ${res.data.name}`));
    if (res.data.isDefault) console.log(c.dim('  Set as platform default.'));
    if (chosenSecretName) {
      console.log(c.dim(`  Using vault secret: ${chosenSecretName}`));
    } else if (apiKeyEnv) {
      console.log(c.dim(`  Make sure the server has ${apiKeyEnv} set in its .env or secret manager.`));
    }
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
      if (llm.secretId) {
        console.log(c.dim('  Check the vault secret is set + the master key matches; verify the base URL.'));
      } else if (llm.apiKeyEnv) {
        console.log(c.dim(`  Check ${llm.apiKeyEnv} is set in the server .env and the base URL is correct.`));
      } else {
        console.log(c.dim('  No API key source configured. Use `gestalt platform llms add` with a vault secret or env var.'));
      }
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to test LLM ${name}`);
  }
}

// ─── platform secrets (Session 4) ────────────────────────────────────────────

export async function platformSecretsListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformSecrets();
    blank();
    console.log(c.bold(`Platform secrets (${res.data.length})`));
    divider();
    if (res.data.length === 0) {
      console.log(c.dim('No secrets stored. Use `gestalt platform secrets add` to register one.'));
    } else {
      printTable(
        res.data.map((s) => ({
          name:        s.name,
          description: s.description ?? c.dim('(none)'),
          updated:     formatAge(new Date(s.updatedAt)),
        })),
        [
          { key: 'name',        header: 'Name',        width: 28 },
          { key: 'description', header: 'Description', width: 38 },
          { key: 'updated',     header: 'Updated',     width: 14 },
        ],
      );
    }
    blank();
    if (res.lastRotation) {
      const when = formatAge(new Date(res.lastRotation.rotatedAt));
      const secrets = res.lastRotation.secretCount;
      console.log(c.dim(`Master key: last rotated ${when} (${secrets} secret${secrets === 1 ? '' : 's'})`));
    } else {
      console.log(c.dim('Master key: never rotated'));
    }
    console.log(c.dim('Secret values are never displayed. Use `secrets rotate-key` to rotate the master key.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list secrets');
  }
}

export async function platformSecretsAddCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;

  blank();
  console.log(c.bold('Register a platform secret'));
  divider();
  const name = (await prompt('Name (e.g. "OpenAI API Key"):')).trim();
  if (!name) { console.log(c.error('Name required')); process.exit(1); }
  const description = (await prompt('Description (optional):')).trim() || null;
  const value = await promptSecret('Secret value:');
  if (!value) { console.log(c.error('Value required')); process.exit(1); }
  const confirmValue = await promptSecret('Confirm value:');
  if (value !== confirmValue) {
    console.log(c.error('Values do not match'));
    process.exit(1);
  }
  try {
    const res = await client.createPlatformSecret({ name, value, description });
    blank();
    console.log(c.success(`✓ Secret saved: ${res.data.name}`));
    console.log(c.dim('  Encrypted under the server master key. Cannot be re-read; use `secrets rotate` to change it.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to save secret');
  }
}

export async function platformSecretsRotateCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const target = await resolveSecretByName(client, name);
    blank();
    console.log(c.dim(`Rotating "${target.name}". The old value is unrecoverable after this.`));
    const value = await promptSecret('New value:');
    if (!value) { console.log(c.error('Value required')); process.exit(1); }
    const confirmValue = await promptSecret('Confirm:');
    if (value !== confirmValue) {
      console.log(c.error('Values do not match'));
      process.exit(1);
    }
    await client.updatePlatformSecret(target.id, { value });
    blank();
    console.log(c.success(`✓ Secret rotated: ${target.name}`));
    console.log(c.dim('  Old value is gone — no recovery possible.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to rotate ${name}`);
  }
}

/**
 * `gestalt platform secrets rotate-key` — atomic master-key rotation.
 *
 * Either auto-generates a new 32-byte key OR accepts an operator-supplied
 * base64-encoded value. Shows the key ONCE and requires confirmation
 * before calling the server. The server re-encrypts every secret inside
 * a single DB transaction; rollback on any failure keeps the old key
 * active.
 *
 * The operator MUST back up the new key out of band — if it is lost,
 * every stored secret becomes unrecoverable.
 */
export async function platformSecretsRotateKeyCommand(
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;

  blank();
  console.log(c.bold('Master key rotation'));
  divider();
  console.log(c.dim('⚠  Master key rotation re-encrypts all vault secrets.'));
  console.log(c.dim('   Back up your current master.key before proceeding.'));
  blank();
  console.log('Options:');
  console.log('  (1) Generate a new random key automatically');
  console.log('  (2) Provide my own key (base64-encoded 32 bytes)');
  blank();
  const choiceRaw = (await prompt('Choice [1]:')).trim() || '1';
  if (choiceRaw !== '1' && choiceRaw !== '2') {
    console.log(c.error('Invalid choice — must be 1 or 2.'));
    process.exit(1);
  }

  let newKey: string;
  if (choiceRaw === '1') {
    console.log(c.dim('\nGenerating new 32-byte master key...'));
    newKey = randomBytes(32).toString('base64');
  } else {
    newKey = (await promptSecret('Paste your 32-byte base64-encoded key:')).trim();
    if (!newKey) {
      console.log(c.error('Key required.'));
      process.exit(1);
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(newKey, 'base64');
    } catch {
      console.log(c.error('Key must be valid base64.'));
      process.exit(1);
    }
    if (decoded.length !== 32) {
      console.log(c.error(`Key decodes to ${decoded.length} bytes; must be exactly 32.`));
      process.exit(1);
    }
  }

  blank();
  console.log(c.bold('New key:'));
  console.log(`  ${newKey}`);
  blank();
  console.log(c.error('⚠ IMPORTANT: Save this key now — it will not be shown again.'));
  console.log(c.dim('   If you lose it, all stored secrets are unrecoverable.'));
  blank();
  if (!await confirm('Have you saved the key?')) {
    console.log(c.dim('Aborted — no rotation performed.'));
    return;
  }

  try {
    blank();
    process.stdout.write('Rotating secrets... ');
    const res = await client.rotatePlatformMasterKey(newKey);
    console.log(c.success('✓'));
    console.log(c.success(`Master key rotated: ${res.data.rotated} secret${res.data.rotated === 1 ? '' : 's'} re-encrypted`));
    console.log(c.dim(`  Rotation logged at ${new Date(res.data.rotatedAt).toLocaleString()}`));
    blank();
    console.log(c.dim('  If your server reads GESTALT_MASTER_KEY from an env var, update it now.'));
    console.log(c.dim('  If it reads from a master.key file, the server already updated it.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Rotation failed — no secrets were changed');
  }
}

export async function platformSecretsRemoveCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const target = await resolveSecretByName(client, name);
    if (!await confirm(`Remove secret '${target.name}'?`)) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.deletePlatformSecret(target.id);
    blank();
    console.log(c.success(`✓ Secret removed: ${target.name}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove ${name}`);
  }
}

async function resolveSecretByName(
  client: GestaltApiClient,
  name: string,
): Promise<PlatformSecretSummary> {
  const res = await client.listPlatformSecrets();
  const match = res.data.find((s) => s.name === name);
  if (!match) {
    console.log(c.error(`No secret named '${name}'. Run: gestalt platform secrets list`));
    process.exit(1);
  }
  return match;
}

// ─── platform projects (cross-project management) ────────────────────────────

/**
 * `gestalt platform projects list` — table of every registered project
 * with the platform-admin enrichment fields (member count, intent
 * count, last activity).
 *
 * Unlike `gestalt projects list` (which shows ONLY the current user's
 * projects via membership), this command requires platform-admin and
 * always returns the full set.
 */
export async function platformProjectsListCommand(
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listProjects();
    const rows = res.data;
    if (rows.length === 0) {
      console.log(c.dim('No projects registered.'));
      return;
    }
    blank();
    printTable(
      rows.map((p) => ({
        name: c.info(p.name),
        members: String(p.memberCount ?? '—'),
        intents: String(p.intentCount ?? '—'),
        activity: formatAge(new Date(p.lastActivityAt ?? p.createdAt)),
        gitUrl: c.dim(p.gitUrl),
      })),
      [
        { key: 'name',     header: 'Name',          width: 26 },
        { key: 'members',  header: 'Members',       width: 10 },
        { key: 'intents',  header: 'Intents',       width: 10 },
        { key: 'activity', header: 'Last activity', width: 16 },
        { key: 'gitUrl',   header: 'Git URL',       width: 48 },
      ],
    );
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list projects');
  }
}

/**
 * `gestalt platform projects delete <name>` — destructive. Prompts the
 * operator to type the project name to confirm. Refuses with
 * `PROJECT_HAS_ACTIVE_INTENTS` when any cycle is in flight; the CLI
 * surfaces the typed error message so the operator knows to wait or
 * intervene.
 */
export async function platformProjectsDeleteCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listProjects();
    const target = res.data.find((p) => p.name === name);
    if (!target) {
      console.log(c.error(`No project named '${name}'. Run: gestalt platform projects list`));
      process.exit(1);
    }
    blank();
    console.log(c.warn(`Delete project "${target.name}"?`));
    console.log(c.dim('  This will permanently delete:'));
    console.log(c.dim(`    • ${target.intentCount ?? 0} intents and their execution history`));
    console.log(c.dim(`    • ${target.memberCount ?? 0} member assignments`));
    console.log(c.dim('    • Git credentials and maintenance run history'));
    console.log(c.dim('  The Git repository itself will NOT be deleted.'));
    blank();
    const typed = await prompt('Type the project name to confirm: ');
    if (typed.trim() !== target.name) {
      console.log(c.error('Names do not match. Aborted.'));
      process.exit(1);
    }
    await client.deleteProject(target.id);
    blank();
    console.log(c.success(`✓ Project deleted: ${target.name}`));
    blank();
  } catch (err) {
    // Surface PROJECT_HAS_ACTIVE_INTENTS explicitly so the operator
    // gets actionable guidance rather than a JSON dump.
    if (err instanceof Error && err.message.includes('PROJECT_HAS_ACTIVE_INTENTS')) {
      console.log(c.error('✗ Cannot delete — this project has active intents.'));
      console.log(c.dim('  Wait for them to complete or fail, or intervene via `gestalt alerts`.'));
      process.exit(1);
    }
    handleErr(err, serverUrl, `Failed to delete ${name}`);
  }
}

/**
 * `gestalt platform projects create` — interactive. Same shape as
 * `gestalt init` but auto-assigns the platform-admin as project-admin
 * and runs the init-harness step inline.
 */
export async function platformProjectsCreateCommand(
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const name = (await prompt('Project name: ')).trim();
    if (!name) { console.log(c.error('Name required')); process.exit(1); }
    const gitUrl = (await prompt('Git repository URL: ')).trim();
    if (!gitUrl) { console.log(c.error('Git URL required')); process.exit(1); }
    const branchInput = (await prompt('Default branch [main]: ')).trim();
    const defaultBranch = branchInput || 'main';
    const gitToken = await promptSecret('Git token (PAT): ');
    if (!gitToken) { console.log(c.error('Git token required')); process.exit(1); }
    const description = (await prompt('Description (optional): ')).trim()
      || `Project ${name} created via platform admin`;

    blank();
    console.log(c.dim('Registering project...'));
    const created = await client.createProject({ name, gitUrl, defaultBranch, gitToken });
    console.log(c.dim('Initialising harness (clone + commit + push)...'));
    await client.initHarness(created.data.id, description);
    blank();
    console.log(c.success(`✓ Project created and harness initialised: ${created.data.name}`));
    console.log(c.dim(`  ${gitUrl} (${defaultBranch})`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to create project');
  }
}

function formatAge(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
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
