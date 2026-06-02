/**
 * gestalt users — platform user management (migration 010).
 *
 *   gestalt users list [--search <s>]
 *   gestalt users add <email>
 *   gestalt users role <email> <platform-admin|user>
 *   gestalt users deactivate <email>
 *   gestalt users assign <email> <projectName> --role <role>
 *   gestalt users unassign <email> <projectName>
 *   gestalt users members <projectName>
 *
 * All commands require an authenticated platform-admin (except
 * `members`, which any project member may run). Server-side guards
 * enforce the actual permissions; the CLI mirrors them so failures
 * are loud.
 */

import { GestaltApiClient, type ProjectRoleString, type UserRoleString, type UserSummary } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import { c, blank, divider, printTable, prompt, promptSecret, confirm, select } from '../ui/prompts';

const PLATFORM_ROLES: readonly UserRoleString[] = ['platform-admin', 'user'];
const PROJECT_ROLES: readonly ProjectRoleString[] = ['project-admin', 'editor', 'reader'];

interface BaseOptions { server?: string }

async function getClient(options: BaseOptions): Promise<{ client: GestaltApiClient; serverUrl: string }> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  return { client: new GestaltApiClient({ serverUrl, token: config.token }), serverUrl };
}

function handleError(err: unknown, serverUrl: string, action: string): void {
  if (isConnectivityError(err)) {
    printConnectionError(serverUrl);
  } else {
    console.log(c.error(`Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(1);
}

// ─── list ────────────────────────────────────────────────────────────────────

export async function usersListCommand(options: BaseOptions & { search?: string } = {}): Promise<void> {
  const { client, serverUrl } = await getClient(options);
  try {
    const { data: users } = await client.listUsers({ search: options.search });
    blank();
    if (users.length === 0) {
      console.log(c.dim('No users found.'));
      blank();
      return;
    }
    console.log(c.bold(`Users (${users.length})`));
    divider();
    printTable(
      users.map((u) => ({
        email: u.email,
        name: u.displayName,
        role: u.role === 'platform-admin' ? '★ platform-admin' : 'user',
        status: u.deactivatedAt ? c.error('deactivated') : c.success('active'),
      })),
      [
        { key: 'email', header: 'Email', width: 32 },
        { key: 'name', header: 'Display name', width: 24 },
        { key: 'role', header: 'Role', width: 20 },
        { key: 'status', header: 'Status', width: 14 },
      ],
    );
    blank();
  } catch (err) {
    handleError(err, serverUrl, 'list users');
  }
}

// ─── add ─────────────────────────────────────────────────────────────────────

export async function usersAddCommand(email: string, options: BaseOptions = {}): Promise<void> {
  const { client, serverUrl } = await getClient(options);
  try {
    const displayName = (await prompt('Display name: ')).trim();
    if (!displayName) {
      console.log(c.error('Display name is required.'));
      process.exit(1);
    }
    const role = await select('Platform role:', [
      { label: 'user (default)', value: 'user' },
      { label: 'platform-admin', value: 'platform-admin' },
    ]) as UserRoleString;
    const password = await promptSecret('Password (press Enter to skip — for IdP-only users): ');
    if (password && password.length > 0 && password.length < 8) {
      console.log(c.error('Password must be at least 8 characters.'));
      process.exit(1);
    }
    blank();
    const { data: user } = await client.createUser({
      email,
      displayName,
      role,
      password: password.length > 0 ? password : undefined,
    });
    console.log(c.success(`✓ User created: ${user.email}`));
    console.log(c.dim(`  id:   ${user.id}`));
    console.log(c.dim(`  role: ${user.role}`));
    if (!password) {
      console.log(c.dim('  (no password set — user must authenticate via IdP)'));
    }
    blank();
  } catch (err) {
    handleError(err, serverUrl, 'create user');
  }
}

// ─── role ────────────────────────────────────────────────────────────────────

/**
 * Returns every user row whose email matches (case-insensitive).
 *
 * Why this exists: per ADR-026, PlatformUser is a shadow record
 * keyed by `(idp_subject, auth_provider)`. A single human who signs
 * in via more than one IdP has one row per provider — same email,
 * different IDs. The `users` admin surfaces have to handle that
 * case explicitly; quietly picking the first row (which was the
 * previous behaviour) hits the wrong record when a duplicate
 * exists.
 */
async function resolveUsersByEmail(client: GestaltApiClient, email: string): Promise<UserSummary[]> {
  const { data: users } = await client.listUsers({ search: email });
  return users.filter((u) => u.email.toLowerCase() === email.toLowerCase());
}

/** Single-match helper for commands that operate on one user row
 *  (role / assign / unassign). Returns null when no match; prints
 *  a disambiguation message + exits when there are multiple. */
async function resolveSingleUserByEmail(
  client: GestaltApiClient,
  email: string,
  commandLabel: string,
): Promise<UserSummary | null> {
  const matches = await resolveUsersByEmail(client, email);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  console.log(c.error(
    `Email '${email}' has ${matches.length} user records (one per IdP provider).`,
  ));
  blank();
  console.log(c.dim('Rows:'));
  for (const u of matches) {
    const deact = u.deactivatedAt ? c.error('(deactivated)') : '';
    console.log(`  ${u.id.slice(0, 8)}…  provider=${u.authProvider}  role=${u.role}  ${deact}`);
  }
  blank();
  console.log(c.dim(
    `\`${commandLabel}\` operates on a single row — re-run against the dashboard's Admin view if you need to pick a specific provider.`,
  ));
  process.exit(1);
}

export async function usersRoleCommand(
  email: string,
  role: string,
  options: BaseOptions = {},
): Promise<void> {
  if (!PLATFORM_ROLES.includes(role as UserRoleString)) {
    console.log(c.error(`Invalid role '${role}'. Valid: ${PLATFORM_ROLES.join(', ')}`));
    process.exit(1);
  }
  const { client, serverUrl } = await getClient(options);
  try {
    const user = await resolveSingleUserByEmail(client, email, 'users role');
    if (!user) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    await client.updateUser(user.id, { role: role as UserRoleString });
    console.log(c.success(`✓ Role updated: ${email} → ${role}`));
  } catch (err) {
    handleError(err, serverUrl, 'update role');
  }
}

// ─── deactivate ──────────────────────────────────────────────────────────────

export async function usersDeactivateCommand(email: string, options: BaseOptions = {}): Promise<void> {
  const { client, serverUrl } = await getClient(options);
  try {
    // ADR-026 — multiple shadow rows per human are normal (one per
    // IdP). The operator's intent in saying "deactivate this user"
    // is to block ALL access, which means hitting every row that
    // shares the email. List them up front so the operator sees
    // what's about to happen; the confirmation message names the
    // count.
    const matches = await resolveUsersByEmail(client, email);
    if (matches.length === 0) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    const active = matches.filter((u) => !u.deactivatedAt);
    if (active.length === 0) {
      console.log(c.dim(`All ${matches.length} row(s) for '${email}' are already deactivated. Nothing to do.`));
      return;
    }
    blank();
    if (matches.length > 1) {
      console.log(c.dim(`Email '${email}' has ${matches.length} user records (one per IdP provider):`));
      for (const u of matches) {
        const status = u.deactivatedAt
          ? c.error('deactivated')
          : c.success('active');
        console.log(`  ${u.id.slice(0, 8)}…  provider=${u.authProvider}  role=${u.role}  ${status}`);
      }
      blank();
    }
    const prompt = active.length === 1
      ? `Deactivate ${email}? This will block all access.`
      : `Deactivate ${active.length} active row(s) for ${email}? This will block all access from every IdP.`;
    const ok = await confirm(prompt, false);
    if (!ok) {
      console.log(c.dim('Aborted.'));
      return;
    }
    let deactivated = 0;
    for (const u of active) {
      await client.deactivateUser(u.id);
      deactivated++;
    }
    console.log(c.success(`✓ Deactivated ${deactivated} row(s) for ${email}.`));
    blank();
  } catch (err) {
    handleError(err, serverUrl, 'deactivate user');
  }
}

// ─── assign / unassign / members ─────────────────────────────────────────────

export async function usersAssignCommand(
  email: string,
  projectName: string,
  options: BaseOptions & { role?: string } = {},
): Promise<void> {
  const role = options.role ?? 'editor';
  if (!PROJECT_ROLES.includes(role as ProjectRoleString)) {
    console.log(c.error(`Invalid project role '${role}'. Valid: ${PROJECT_ROLES.join(', ')}`));
    process.exit(1);
  }
  const { client, serverUrl } = await getClient(options);
  try {
    const user = await resolveSingleUserByEmail(client, email, 'users assign');
    if (!user) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    const { data: projects } = await client.listProjects();
    const project = projects.find((p) => p.name === projectName);
    if (!project) {
      console.log(c.error(`No project named '${projectName}'.`));
      process.exit(1);
    }
    await client.addProjectMember(project.id, { userId: user.id, role: role as ProjectRoleString });
    console.log(c.success(`✓ ${email} assigned to ${projectName} as ${role}`));
  } catch (err) {
    handleError(err, serverUrl, 'assign user');
  }
}

export async function usersUnassignCommand(
  email: string,
  projectName: string,
  options: BaseOptions = {},
): Promise<void> {
  const { client, serverUrl } = await getClient(options);
  try {
    const user = await resolveSingleUserByEmail(client, email, 'users unassign');
    if (!user) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    const { data: projects } = await client.listProjects();
    const project = projects.find((p) => p.name === projectName);
    if (!project) {
      console.log(c.error(`No project named '${projectName}'.`));
      process.exit(1);
    }
    await client.removeProjectMember(project.id, user.id);
    console.log(c.success(`✓ ${email} removed from ${projectName}`));
  } catch (err) {
    handleError(err, serverUrl, 'remove user');
  }
}

export async function usersMembersCommand(projectName: string, options: BaseOptions = {}): Promise<void> {
  const { client, serverUrl } = await getClient(options);
  try {
    const { data: projects } = await client.listProjects();
    const project = projects.find((p) => p.name === projectName);
    if (!project) {
      console.log(c.error(`No project named '${projectName}'.`));
      process.exit(1);
    }
    const { data: members } = await client.listProjectMembers(project.id);
    blank();
    if (members.length === 0) {
      console.log(c.dim('No members.'));
      blank();
      return;
    }
    console.log(c.bold(`${projectName} — members (${members.length})`));
    divider();
    printTable(
      members.map((m) => ({
        email: m.email,
        name: m.displayName,
        projectRole: m.projectRole,
        platformRole: m.platformRole === 'platform-admin' ? '★' : '',
      })),
      [
        { key: 'email', header: 'Email', width: 32 },
        { key: 'name', header: 'Display name', width: 24 },
        { key: 'projectRole', header: 'Project role', width: 16 },
        { key: 'platformRole', header: '', width: 2 },
      ],
    );
    blank();
  } catch (err) {
    handleError(err, serverUrl, 'list members');
  }
}
