/**
 * Platform admin extras (Session 3 — migration 017).
 *
 *   gestalt platform templates list/upload/set-default/delete
 *   gestalt platform mcp list/add/enable/disable/test/remove
 *   gestalt platform tools list
 *   gestalt platform identity show/configure/enable/disable/reload
 *                              add-role-mapping/remove-role-mapping
 *
 * The template upload reads a ZIP via `adm-zip` (Node-side), extracts
 * the file content into a path → content map, and POSTs it to
 * `/platform/templates`. The server then validates that AGENTS.md +
 * HARNESS.json + agents.yaml are present (by basename).
 */

import { readFileSync } from 'fs';
import AdmZip from 'adm-zip';
import {
  GestaltApiClient,
  type PlatformTemplateSummary, type PlatformMcpServer,
  type PlatformToolInfo, type IdentityStateResponse,
  type PlatformSecretSummary,
  type PlatformGroupSummary,
  type SelfHealingConfigSummary,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, prompt, confirm,
} from '../ui/prompts';

interface BaseOptions { server?: string }

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

function handleErr(err: unknown, serverUrl: string, label: string): never {
  if (isConnectivityError(err)) {
    printConnectionError(serverUrl);
  } else {
    console.log(c.error(`${label}: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(1);
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function platformTemplatesListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformTemplates();
    if (res.data.length === 0) {
      console.log(c.dim('No templates registered.'));
      return;
    }
    blank();
    printTable(
      res.data.map((t: PlatformTemplateSummary) => ({
        slug:    (t.isDefault ? c.success('★ ') : '  ') + c.info(t.slug),
        name:    t.name,
        tier:    t.tier + (t.isBuiltin ? c.dim(' (built-in)') : ''),
        version: t.version,
      })),
      [
        { key: 'slug',    header: 'Slug',    width: 32 },
        { key: 'name',    header: 'Name',    width: 32 },
        { key: 'tier',    header: 'Tier',    width: 22 },
        { key: 'version', header: 'Version', width: 10 },
      ],
    );
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list templates');
  }
}

export async function platformTemplatesUploadCommand(
  zipPath: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    // Read + extract the ZIP into a path → content map.
    const buf = readFileSync(zipPath);
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      files[entry.entryName] = entry.getData().toString('utf8');
    }
    if (Object.keys(files).length === 0) {
      console.log(c.error(`No files found in ${zipPath}`));
      process.exit(1);
    }

    console.log(c.dim(`Extracted ${Object.keys(files).length} files from ${zipPath}.`));
    const name = (await prompt('Template name: ')).trim();
    if (!name) { console.log(c.error('Name required')); process.exit(1); }
    const slug = (await prompt('Slug (kebab-case): ')).trim();
    if (!slug) { console.log(c.error('Slug required')); process.exit(1); }
    const description = (await prompt('Description (optional): ')).trim() || null;
    const tier = (await prompt('Tier [Custom]: ')).trim() || 'Custom';
    const version = (await prompt('Version [1.0.0]: ')).trim() || '1.0.0';

    blank();
    console.log(c.dim('Uploading template...'));
    await client.createPlatformTemplate({ slug, name, description, tier, version, files });
    blank();
    console.log(c.success(`✓ Template uploaded: ${slug}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to upload ${zipPath}`);
  }
}

export async function platformTemplatesSetDefaultCommand(
  slug: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformTemplates();
    const target = res.data.find((t) => t.slug === slug);
    if (!target) {
      console.log(c.error(`No template with slug '${slug}'. Run: gestalt platform templates list`));
      process.exit(1);
    }
    await client.setDefaultPlatformTemplate(target.id);
    blank();
    console.log(c.success(`✓ Default template set: ${slug}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to set default ${slug}`);
  }
}

export async function platformTemplatesDeleteCommand(
  slug: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformTemplates();
    const target = res.data.find((t) => t.slug === slug);
    if (!target) {
      console.log(c.error(`No template with slug '${slug}'.`));
      process.exit(1);
    }
    if (!(await confirm(`Delete template '${slug}'?`))) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.deletePlatformTemplate(target.id);
    blank();
    console.log(c.success(`✓ Template deleted: ${slug}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to delete ${slug}`);
  }
}

/**
 * `gestalt platform templates inspect <slug>` (Brief 3) — print the
 * template's files + per-`{{variable}}` usage. Operators see at a
 * glance which placeholders the template uses, whether each is
 * auto-provided / documented / undocumented, and in which files
 * the variable appears.
 */
export async function platformTemplatesInspectCommand(
  slug: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const list = await client.listPlatformTemplates();
    const summary = list.data.find((t) => t.slug === slug);
    if (!summary) {
      console.log(c.error(`No template with slug '${slug}'.`));
      console.log(c.dim('  Run: gestalt platform templates list'));
      process.exit(1);
    }
    const res = await client.getPlatformTemplate(summary.id);
    const t = res.data;
    blank();
    console.log(c.bold(`Template: ${t.name}`));
    console.log(c.dim(`  Slug:     ${t.slug}`));
    console.log(c.dim(`  Tier:     ${t.tier}  Version: ${t.version}`));
    console.log(c.dim(`  Default:  ${t.isDefault ? '★ yes' : 'no'}  ${t.isBuiltin ? '(built-in)' : ''}`));
    if (t.description) {
      console.log(c.dim(`  Description: ${t.description}`));
    }
    blank();
    const fileNames = Object.keys(t.files).sort();
    console.log(c.bold(`Files (${fileNames.length}):`));
    for (const f of fileNames) {
      console.log(`  ${f}`);
    }
    blank();
    const usage = t.variableUsage ?? [];
    console.log(c.bold(`Variables (${usage.length}):`));
    if (usage.length === 0) {
      console.log(c.dim('  No {{variable}} placeholders detected.'));
    } else {
      printTable(
        usage.map((v) => {
          const status = v.autoProvided ? c.success('✓ Auto')
            : v.defined ? c.success('✓ Documented')
            : c.warn('⚠ Undocumented');
          const filesLine = v.usedInFiles.length === 1
            ? v.usedInFiles[0]!
            : `Used in ${v.usedInFiles.length} files`;
          return {
            status,
            name:  v.name,
            files: filesLine,
          };
        }),
        [
          { key: 'status', header: '',         width: 18 },
          { key: 'name',   header: 'Name',     width: 24 },
          { key: 'files',  header: 'Used in',  width: 50 },
        ],
      );
      const undocumented = usage.filter((v) => !v.autoProvided && !v.defined);
      if (undocumented.length > 0) {
        blank();
        console.log(c.dim(
          `Note: ${undocumented.length} undocumented variable(s) will appear as ` +
          'literal {{varName}} in committed files unless documented in the template metadata.',
        ));
      }
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to inspect ${slug}`);
  }
}

// ─── MCP servers ─────────────────────────────────────────────────────────────

export async function platformMcpListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformMcpServers();
    if (res.data.length === 0) {
      console.log(c.dim('No MCP servers configured.'));
      return;
    }
    blank();
    printTable(
      res.data.map((s: PlatformMcpServer) => ({
        name:    c.info(s.name),
        url:     s.url,
        agents:  s.agentRoles.length === 0 ? 'all' : s.agentRoles.join(', '),
        status:  s.enabled ? c.success('● enabled') : c.dim('○ disabled'),
        secret:  s.secretId ? c.success('🔒 vault') : c.dim('—'),
      })),
      [
        { key: 'name',   header: 'Name',    width: 22 },
        { key: 'url',    header: 'URL',     width: 38 },
        { key: 'agents', header: 'Agents',  width: 22 },
        { key: 'status', header: 'Status',  width: 12 },
        { key: 'secret', header: 'Token',   width: 12 },
      ],
    );
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list MCP servers');
  }
}

export async function platformMcpAddCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const name = (await prompt('Name: ')).trim();
    if (!name) { console.log(c.error('Name required')); process.exit(1); }
    const url = (await prompt('URL (https://... or stdio:...): ')).trim();
    if (!url) { console.log(c.error('URL required')); process.exit(1); }
    const description = (await prompt('Description (optional): ')).trim() || null;
    const agentRolesText = (await prompt('Agent roles (comma-separated; blank = all): ')).trim();
    const agentRoles = agentRolesText ? agentRolesText.split(',').map((s) => s.trim()).filter(Boolean) : [];

    // Optional vault secret
    const secretsRes = await client.listPlatformSecrets();
    let secretId: string | null = null;
    if (secretsRes.data.length > 0) {
      console.log(c.dim('Available vault secrets:'));
      secretsRes.data.forEach((s: PlatformSecretSummary, i: number) => {
        console.log(c.dim(`  ${i + 1}. ${s.name}`));
      });
      console.log(c.dim('  0. (none — anonymous)'));
      const choice = (await prompt('Select bearer token secret [0]: ')).trim();
      if (choice && choice !== '0') {
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < secretsRes.data.length) {
          secretId = secretsRes.data[idx]?.id ?? null;
        }
      }
    }

    blank();
    await client.createPlatformMcpServer({ name, url, description, secretId, agentRoles, enabled: true });
    console.log(c.success(`✓ MCP server added: ${name}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to add MCP server');
  }
}

export async function platformMcpEnableCommand(name: string, options: BaseOptions = {}): Promise<void> {
  await setMcpEnabled(name, true, options);
}

export async function platformMcpDisableCommand(name: string, options: BaseOptions = {}): Promise<void> {
  await setMcpEnabled(name, false, options);
}

async function setMcpEnabled(name: string, enabled: boolean, options: BaseOptions): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformMcpServers();
    const target = res.data.find((s) => s.name === name);
    if (!target) { console.log(c.error(`No MCP server named '${name}'.`)); process.exit(1); }
    await client.updatePlatformMcpServer(target.id, { enabled });
    console.log(c.success(`✓ MCP server ${enabled ? 'enabled' : 'disabled'}: ${name}`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to update ${name}`);
  }
}

export async function platformMcpTestCommand(name: string, options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformMcpServers();
    const target = res.data.find((s) => s.name === name);
    if (!target) { console.log(c.error(`No MCP server named '${name}'.`)); process.exit(1); }
    const result = await client.testPlatformMcpServer(target.id);
    if (result.data.ok) {
      console.log(c.success(`✓ ${name} reachable — ${result.data.toolCount} tools available (${result.data.latencyMs}ms)`));
    } else {
      console.log(c.error(`✗ ${name} unreachable — ${result.data.error ?? 'unknown error'} (${result.data.latencyMs}ms)`));
    }
  } catch (err) {
    handleErr(err, serverUrl, `Failed to test ${name}`);
  }
}

export async function platformMcpRemoveCommand(name: string, options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformMcpServers();
    const target = res.data.find((s) => s.name === name);
    if (!target) { console.log(c.error(`No MCP server named '${name}'.`)); process.exit(1); }
    if (!(await confirm(`Remove MCP server '${name}'?`))) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.deletePlatformMcpServer(target.id);
    console.log(c.success(`✓ MCP server removed: ${name}`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove ${name}`);
  }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export async function platformToolsListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformTools();
    blank();
    res.data.forEach((t: PlatformToolInfo) => {
      console.log(c.info(t.name));
      console.log(c.dim(`  ${t.description}`));
      console.log(c.dim(`  Default agents: ${t.defaultAgents.length > 0 ? t.defaultAgents.join(', ') : 'none'}`));
      blank();
    });
    console.log(c.dim('To add MCP tools, configure Platform MCP Servers (gestalt platform mcp add).'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list tools');
  }
}

// ─── Identity ────────────────────────────────────────────────────────────────

export async function platformIdentityShowCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.getPlatformIdentity();
    blank();
    console.log(c.info('Active providers: ') + (res.data.activeProviders.length > 0 ? res.data.activeProviders.join(', ') : 'local only'));
    blank();
    divider();
    console.log(c.info('Providers'));
    if (res.data.providers.length === 0) {
      console.log(c.dim('  (none configured — local fallback only)'));
    } else {
      res.data.providers.forEach((p) => {
        const status = p.enabled ? c.success('● enabled') : c.dim('○ disabled');
        console.log(`  ${p.provider}  ${status}`);
      });
    }
    blank();
    divider();
    console.log(c.info('Role mappings'));
    if (res.data.roleMappings.length === 0) {
      console.log(c.dim('  (none configured)'));
    } else {
      res.data.roleMappings.forEach((m) => {
        console.log(`  ${m.groupName} → ${m.platformRole}`);
      });
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to load identity config');
  }
}

export async function platformIdentityConfigureCommand(
  providerType: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  if (!['kerberos', 'saml', 'oidc'].includes(providerType)) {
    console.log(c.error(`Invalid provider '${providerType}'. Must be one of: kerberos, saml, oidc`));
    process.exit(1);
  }
  try {
    blank();
    console.log(c.dim(`Configure ${providerType} — supply a JSON config (one line). Sensitive fields use *SecretId references.`));
    console.log(c.dim('Examples:'));
    if (providerType === 'kerberos') {
      console.log(c.dim('  {"realm":"COMPANY.COM","serviceAccount":"HTTP/gestalt.company.com","keytabSecretId":"<uuid>"}'));
    } else if (providerType === 'saml') {
      console.log(c.dim('  {"entryPoint":"https://adfs.company.com/adfs/ls/","issuer":"https://gestalt.company.com","callbackUrl":"https://gestalt.company.com/auth/saml/callback","certSecretId":"<uuid>"}'));
    } else {
      console.log(c.dim('  {"issuer":"https://login.microsoftonline.com/.../v2.0","clientId":"<uuid>","redirectUri":"https://gestalt.company.com/auth/oidc/callback","scope":"openid profile email groups","clientSecretSecretId":"<uuid>"}'));
    }
    const jsonText = (await prompt(`${providerType} JSON config: `)).trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonText) as Record<string, unknown>; }
    catch (err) { console.log(c.error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)); process.exit(1); }

    await client.patchIdentityProvider(providerType as 'kerberos' | 'saml' | 'oidc', { config: parsed });
    blank();
    console.log(c.success(`✓ ${providerType} configured.`));
    console.log(c.dim('Run: gestalt platform identity reload  — to activate'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to configure ${providerType}`);
  }
}

export async function platformIdentityEnableCommand(
  providerType: string,
  options: BaseOptions = {},
): Promise<void> {
  await setIdentityEnabled(providerType, true, options);
}

export async function platformIdentityDisableCommand(
  providerType: string,
  options: BaseOptions = {},
): Promise<void> {
  await setIdentityEnabled(providerType, false, options);
}

async function setIdentityEnabled(providerType: string, enabled: boolean, options: BaseOptions): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  if (!['kerberos', 'saml', 'oidc'].includes(providerType)) {
    console.log(c.error(`Invalid provider '${providerType}'. Must be one of: kerberos, saml, oidc`));
    process.exit(1);
  }
  try {
    await client.patchIdentityProvider(providerType as 'kerberos' | 'saml' | 'oidc', { enabled });
    console.log(c.success(`✓ ${providerType} ${enabled ? 'enabled' : 'disabled'}.`));
    console.log(c.dim('Run: gestalt platform identity reload  — to activate'));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to update ${providerType}`);
  }
}

export async function platformIdentityReloadCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.reloadIdentity();
    console.log(c.success(`✓ Auth reloaded. Active providers: ${res.data.providers.join(', ')}`));
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to reload identity');
  }
}

export async function platformIdentityAddRoleMappingCommand(
  groupName: string,
  platformRole: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  if (!['platform-admin', 'user'].includes(platformRole)) {
    console.log(c.error(`Invalid role '${platformRole}'. Must be one of: platform-admin, user`));
    process.exit(1);
  }
  try {
    await client.addRoleMapping({ groupName, platformRole: platformRole as 'platform-admin' | 'user' });
    console.log(c.success(`✓ Role mapping added: ${groupName} → ${platformRole}`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to add mapping ${groupName}`);
  }
}

export async function platformIdentityRemoveRoleMappingCommand(
  groupName: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.getPlatformIdentity();
    const target = (res.data as IdentityStateResponse).roleMappings.find((m) => m.groupName === groupName);
    if (!target) { console.log(c.error(`No mapping for group '${groupName}'.`)); process.exit(1); }
    await client.removeRoleMapping(target.id);
    console.log(c.success(`✓ Role mapping removed: ${groupName}`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove mapping ${groupName}`);
  }
}

// ─── Platform groups (Brief 1 — bulk user management) ────────────────────────

const VALID_GROUP_ROLES = new Set(['project-admin', 'editor', 'reader']);

async function resolveGroupByName(
  client: GestaltApiClient,
  name: string,
): Promise<PlatformGroupSummary> {
  const res = await client.listPlatformGroups();
  const match = res.data.find((g) => g.name === name);
  if (!match) {
    console.log(c.error(`No group named '${name}'. Run: gestalt platform groups list`));
    process.exit(1);
  }
  return match;
}

async function resolveUserByEmail(client: GestaltApiClient, email: string): Promise<{ id: string; email: string }> {
  const res = await client.listUsers({ search: email });
  const match = res.data.find((u) => u.email === email);
  if (!match) {
    console.log(c.error(`No user with email '${email}'. Run: gestalt users list`));
    process.exit(1);
  }
  return { id: match.id, email: match.email };
}

async function resolveProjectByName(client: GestaltApiClient, name: string): Promise<{ id: string; name: string }> {
  const res = await client.listProjects();
  const match = res.data.find((p) => p.name === name);
  if (!match) {
    console.log(c.error(`No project named '${name}'. Run: gestalt projects list`));
    process.exit(1);
  }
  return { id: match.id, name: match.name };
}

export async function platformGroupsListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listPlatformGroups();
    if (res.data.length === 0) {
      console.log(c.dim('No groups registered.'));
      return;
    }
    blank();
    // Fetch members + projects per row so the count columns are populated.
    const rows = await Promise.all(res.data.map(async (g) => {
      const [m, p] = await Promise.all([
        client.listGroupMembers(g.id).catch(() => ({ data: [] })),
        client.listGroupProjects(g.id).catch(() => ({ data: [] })),
      ]);
      return {
        name: c.info(g.name),
        members: String(m.data.length),
        projects: String(p.data.length),
        description: g.description ? c.dim(g.description) : c.dim('—'),
      };
    }));
    printTable(rows, [
      { key: 'name', header: 'Name', width: 24 },
      { key: 'members', header: 'Members', width: 10 },
      { key: 'projects', header: 'Projects', width: 10 },
      { key: 'description', header: 'Description', width: 40 },
    ]);
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list groups');
  }
}

export async function platformGroupsCreateCommand(
  name: string,
  options: BaseOptions & { description?: string } = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    await client.createPlatformGroup({ name, description: options.description?.trim() || null });
    blank();
    console.log(c.success(`✓ Group created: ${name}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to create group ${name}`);
  }
}

export async function platformGroupsDeleteCommand(name: string, options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const target = await resolveGroupByName(client, name);
    if (!(await confirm(`Delete group '${name}'? Members keep their direct memberships; only group-derived project access is removed.`))) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.deletePlatformGroup(target.id);
    blank();
    console.log(c.success(`✓ Group deleted: ${name}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to delete group ${name}`);
  }
}

export async function platformGroupsAddMemberCommand(
  groupName: string,
  userEmail: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const group = await resolveGroupByName(client, groupName);
    const user = await resolveUserByEmail(client, userEmail);
    await client.addGroupMember(group.id, user.id);
    console.log(c.success(`✓ Added ${userEmail} to group '${groupName}'`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to add member`);
  }
}

export async function platformGroupsRemoveMemberCommand(
  groupName: string,
  userEmail: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const group = await resolveGroupByName(client, groupName);
    const user = await resolveUserByEmail(client, userEmail);
    await client.removeGroupMember(group.id, user.id);
    console.log(c.success(`✓ Removed ${userEmail} from group '${groupName}'`));
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove member`);
  }
}

export async function platformGroupsAssignCommand(
  groupName: string,
  projectName: string,
  options: BaseOptions & { role?: string } = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  const role = options.role ?? 'reader';
  if (!VALID_GROUP_ROLES.has(role)) {
    console.log(c.error(`Invalid role '${role}'. Must be one of: project-admin, editor, reader`));
    process.exit(1);
  }
  try {
    const group = await resolveGroupByName(client, groupName);
    const project = await resolveProjectByName(client, projectName);
    await client.assignGroupToProject(group.id, project.id, role as 'project-admin' | 'editor' | 'reader');
    console.log(c.success(`✓ Assigned group '${groupName}' to project '${projectName}' as ${role}`));
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to assign group');
  }
}

export async function platformGroupsUnassignCommand(
  groupName: string,
  projectName: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const group = await resolveGroupByName(client, groupName);
    const project = await resolveProjectByName(client, projectName);
    await client.unassignGroupFromProject(group.id, project.id);
    console.log(c.success(`✓ Unassigned group '${groupName}' from project '${projectName}'`));
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to unassign group');
  }
}

export async function platformGroupsShowCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const group = await resolveGroupByName(client, name);
    const [m, p] = await Promise.all([
      client.listGroupMembers(group.id),
      client.listGroupProjects(group.id),
    ]);
    blank();
    console.log(c.info(group.name));
    if (group.description) console.log(c.dim(`  ${group.description}`));
    blank();
    console.log(c.info(`Members (${m.data.length})`));
    if (m.data.length === 0) {
      console.log(c.dim('  (none)'));
    } else {
      m.data.forEach((row) => {
        console.log(`  ${row.user.email}  ${c.dim(row.user.displayName)}`);
      });
    }
    blank();
    console.log(c.info(`Project assignments (${p.data.length})`));
    if (p.data.length === 0) {
      console.log(c.dim('  (none)'));
    } else {
      p.data.forEach((row) => {
        console.log(`  ${row.project.name}  ${c.dim(`→ ${row.role}`)}`);
      });
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to show group ${name}`);
  }
}

// ─── Self-healing config (migration 020) ────────────────────────────────────

/**
 * `gestalt platform self-healing list` — print the seven failure-type
 * config rows. The platform's table is small (single-digit) so we
 * fit every row in a single column-aligned table without paging.
 */
export async function platformSelfHealingListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;
  try {
    const res = await client.listSelfHealingConfig();
    blank();
    if (res.data.length === 0) {
      console.log(c.dim('No self-healing config rows. Migration 020 may not have run.'));
      blank();
      return;
    }
    printTable(
      res.data.map((row): Record<string, string> => ({
        type:        row.failureType,
        enabled:     row.enabled ? c.success('✓') : c.dim('✗'),
        maxAttempts: String(row.maxAttempts),
        confidence:  row.confidenceThreshold,
        autoResolve: row.autoResolveAlerts ? c.success('✓') : c.dim('✗'),
      })),
      [
        { key: 'type',        header: 'TYPE',         width: 22 },
        { key: 'enabled',     header: 'ENABLED',      width: 9 },
        { key: 'maxAttempts', header: 'MAX ATTEMPTS', width: 13 },
        { key: 'confidence',  header: 'CONFIDENCE',   width: 11 },
        { key: 'autoResolve', header: 'AUTO-RESOLVE', width: 13 },
      ],
    );
    blank();
    console.log(c.dim(`  ${res.data.length} failure type(s) configured`));
    console.log(c.dim('  Edit with: gestalt platform self-healing configure <failureType> [flags]'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list self-healing config');
  }
}

/**
 * `gestalt platform self-healing configure <failureType>` — partial
 * PATCH against `/platform/self-healing/:failureType`. At least one
 * flag must be supplied; the server's validator returns 400
 * `EMPTY_PATCH` otherwise.
 */
export async function platformSelfHealingConfigureCommand(
  failureType: string,
  options: BaseOptions & {
    maxAttempts?: string;
    confidence?: string;
    autoResolve?: boolean;
    noAutoResolve?: boolean;
    enable?: boolean;
    disable?: boolean;
  } = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, serverUrl } = ctx;

  const body: Partial<SelfHealingConfigSummary> = {};
  if (options.maxAttempts !== undefined) {
    const n = parseInt(options.maxAttempts, 10);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      console.log(c.error('--max-attempts must be an integer between 0 and 10'));
      process.exit(1);
    }
    body.maxAttempts = n;
  }
  if (options.confidence !== undefined) {
    if (options.confidence !== 'high' && options.confidence !== 'medium' && options.confidence !== 'low') {
      console.log(c.error('--confidence must be one of: high, medium, low'));
      process.exit(1);
    }
    body.confidenceThreshold = options.confidence;
  }
  if (options.autoResolve === true) body.autoResolveAlerts = true;
  if (options.noAutoResolve === true) body.autoResolveAlerts = false;
  if (options.enable === true) body.enabled = true;
  if (options.disable === true) body.enabled = false;

  if (Object.keys(body).length === 0) {
    console.log(c.error('No changes supplied. Use --max-attempts, --confidence, --auto-resolve / --no-auto-resolve, --enable / --disable'));
    process.exit(1);
  }

  try {
    const res = await client.updateSelfHealingConfig(failureType, body);
    blank();
    console.log(c.success(`✓ Self-healing config updated for ${failureType}`));
    console.log(c.dim(`  enabled:             ${res.data.enabled}`));
    console.log(c.dim(`  maxAttempts:         ${res.data.maxAttempts}`));
    console.log(c.dim(`  confidenceThreshold: ${res.data.confidenceThreshold}`));
    console.log(c.dim(`  autoResolveAlerts:   ${res.data.autoResolveAlerts}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to update self-healing config for ${failureType}`);
  }
}
