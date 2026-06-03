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
