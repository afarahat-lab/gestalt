/**
 * Admin view — platform-admin only.
 *
 * Four tabs:
 *   - Users: list / create / role-toggle / deactivate, plus inline
 *     per-user project memberships
 *   - Projects: per-project member list with role change + add/remove
 *   - LLMs (Session 3): platform LLM registry — Add / Edit / Test /
 *     Set default / Remove
 *   - Secrets (Session 4): encrypted vault — Add / Rotate / Remove.
 *     Values are never displayed; admins enter them once and reference
 *     them from LLM registrations
 *
 * Route guarded by `RequirePlatformAdmin` in App.tsx; the Admin nav
 * link in Layout is rendered only when `currentUser.role ===
 * 'platform-admin'`, so a regular user has no DOM trace of this view.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';
import { useCurrentUser } from '../context/CurrentUserContext';
import { useProject } from '../context/ProjectContext';
import { ApiError } from '../api/client';
import type {
  UserSummary, UserDetail, ProjectMember, ProjectSummary, UserRole, ProjectRole,
  PlatformLLM, LlmTestResult, PlatformSecret,
  PlatformTemplateSummary, PlatformMcpServer, PlatformMcpTestResult,
  PlatformToolInfo, IdentityState, IdentityProvider, RoleMapping,
  PlatformGroup, GroupMember, GroupProjectAssignment,
} from '../types';

type Tab = 'users' | 'projects' | 'groups' | 'llms' | 'secrets' | 'templates' | 'mcp' | 'tools' | 'identity';

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin</h1>
        <p style={styles.subtitle}>Platform users, project memberships, LLM registry, and the encrypted secrets vault</p>
      </div>
      <div style={styles.tabs}>
        {([
          ['users', 'Users'],
          ['projects', 'Projects'],
          ['groups', 'Groups'],
          ['identity', 'Identity'],
          ['llms', 'LLMs'],
          ['secrets', 'Secrets'],
          ['templates', 'Templates'],
          ['mcp', 'MCP Servers'],
          ['tools', 'Tools'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            style={tab === id ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => setTab(id)}
          >{label}</button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'projects' && <ProjectsTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'identity' && <IdentityTab />}
      {tab === 'llms' && <LlmsTab />}
      {tab === 'secrets' && <SecretsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'mcp' && <McpServersTab />}
      {tab === 'tools' && <ToolsTab />}
    </div>
  );
}

// ─── Users tab ───────────────────────────────────────────────────────────────

function UsersTab() {
  const api = useDashboardApi();
  const { user: currentUser } = useCurrentUser();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, UserDetail | 'loading'>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.listUsers(search ? { search } : undefined);
      setUsers(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.body : String(err));
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function toggleExpand(userId: string) {
    if (expanded === userId) {
      setExpanded(null);
      return;
    }
    setExpanded(userId);
    if (!detail[userId]) {
      setDetail((d) => ({ ...d, [userId]: 'loading' }));
      try {
        const res = await api.getUser(userId);
        setDetail((d) => ({ ...d, [userId]: res.data }));
      } catch (err) {
        setError(err instanceof ApiError ? err.body : String(err));
      }
    }
  }

  async function toggleRole(user: UserSummary) {
    if (user.id === currentUser?.id) {
      setError('Cannot demote yourself');
      return;
    }
    const nextRole: UserRole = user.role === 'platform-admin' ? 'user' : 'platform-admin';
    const ok = window.confirm(
      `Change ${user.email} to ${nextRole}?`
    );
    if (!ok) return;
    try {
      await api.updateUser(user.id, { role: nextRole });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.body : String(err));
    }
  }

  async function deactivate(user: UserSummary) {
    if (user.id === currentUser?.id) {
      setError('Cannot deactivate yourself');
      return;
    }
    const ok = window.confirm(`Deactivate ${user.email}? This will block all access.`);
    if (!ok) return;
    try {
      await api.deactivateUser(user.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.body : String(err));
    }
  }

  return (
    <div>
      <div style={styles.toolbar}>
        <button style={styles.primaryBtn} onClick={() => setShowAddModal(true)}>+ Add user</button>
        <input
          type="text"
          placeholder="Search email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          style={styles.searchBox}
        />
        <button style={styles.muteBtn} onClick={load}>Refresh</button>
      </div>
      {error && (
        <div style={styles.errorStrip}>
          ✗ {error}
          <button style={styles.muteBtn} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Display name</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} style={styles.empty}>No users found</td></tr>
            )}
            {users.map((u) => (
              <React.Fragment key={u.id}>
                <tr style={styles.row} onClick={() => toggleExpand(u.id)}>
                  <td style={styles.td}>{expanded === u.id ? '▼' : '▶'}</td>
                  <td style={styles.td}>{u.email}</td>
                  <td style={styles.td}>{u.displayName}</td>
                  <td style={styles.td}>
                    <button
                      style={u.role === 'platform-admin' ? styles.adminBadge : styles.userBadge}
                      onClick={(e) => { e.stopPropagation(); toggleRole(u); }}
                      title="Click to toggle role"
                    >
                      {u.role === 'platform-admin' ? '★ Platform admin' : 'User'}
                    </button>
                  </td>
                  <td style={styles.td}>
                    {u.deactivatedAt
                      ? <span style={styles.deactivated}>○ deactivated</span>
                      : <span style={styles.active}>● active</span>}
                  </td>
                  <td style={styles.td}>
                    {!u.deactivatedAt && u.id !== currentUser?.id && (
                      <button
                        style={styles.dangerBtn}
                        onClick={(e) => { e.stopPropagation(); deactivate(u); }}
                      >Deactivate</button>
                    )}
                  </td>
                </tr>
                {expanded === u.id && (
                  <tr>
                    <td colSpan={6} style={styles.expanded}>
                      <ExpandedUser
                        detail={detail[u.id]}
                        onChanged={() => { setDetail((d) => ({ ...d, [u.id]: 'loading' })); toggleExpand(u.id); toggleExpand(u.id); }}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); load(); }}
        />
      )}
    </div>
  );
}

function ExpandedUser(props: {
  detail: UserDetail | 'loading' | undefined;
  onChanged: () => void;
}) {
  const api = useDashboardApi();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selProj, setSelProj] = useState('');
  const [selRole, setSelRole] = useState<ProjectRole>('editor');

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.data)).catch(() => {});
  }, [api]);

  // React Rules of Hooks — useMemo must run on every render, NOT
  // be conditionally skipped behind an early-return loading branch.
  // Putting `useMemo` after `if (loading) return ...` caused the
  // hook-count to change between renders (zero on the loading-only
  // first render, one once detail arrived) and React unmounted the
  // whole component tree, which surfaced as a black screen when an
  // operator clicked a user row.
  const isLoaded = props.detail !== 'loading' && props.detail !== undefined;
  const memberships = isLoaded ? (props.detail as UserDetail).memberships : [];
  const memberMap = useMemo(
    () => new Map(memberships.map((m) => [m.projectId, m])),
    [memberships],
  );

  if (!isLoaded) {
    return <div style={styles.muted}>Loading memberships...</div>;
  }
  const d = props.detail as UserDetail;
  const availableProjects = projects.filter((p) => !memberMap.has(p.id));

  async function changeRole(projectId: string, role: ProjectRole) {
    try {
      await api.updateMemberRole(projectId, d.id, role);
      props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }

  async function remove(projectId: string) {
    if (!window.confirm('Remove from project?')) return;
    try {
      await api.removeMember(projectId, d.id);
      props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }

  async function assign() {
    if (!selProj) return;
    try {
      await api.addMember(selProj, { userId: d.id, role: selRole });
      setShowAdd(false);
      setSelProj('');
      props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }

  return (
    <div style={styles.expandedInner}>
      <p style={styles.subhead}>Project memberships</p>
      {d.memberships.length === 0 && (
        <p style={styles.muted}>No project memberships.</p>
      )}
      {d.memberships.length > 0 && (
        <table style={styles.subtable}>
          <thead>
            <tr>
              <th style={styles.th}>Project</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {d.memberships.map((m) => {
              const proj = projects.find((p) => p.id === m.projectId);
              return (
                <tr key={m.id}>
                  <td style={styles.td}>{proj?.name ?? m.projectId.slice(0, 8)}</td>
                  <td style={styles.td}>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.projectId, e.target.value as ProjectRole)}
                      style={styles.roleSelect}
                    >
                      <option value="project-admin">project-admin</option>
                      <option value="editor">editor</option>
                      <option value="reader">reader</option>
                    </select>
                  </td>
                  <td style={styles.td}>
                    <button style={styles.dangerBtn} onClick={() => remove(m.projectId)}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!showAdd && availableProjects.length > 0 && (
        <button style={styles.muteBtn} onClick={() => setShowAdd(true)}>+ Assign to project</button>
      )}
      {showAdd && (
        <div style={styles.inlineRow}>
          <select value={selProj} onChange={(e) => setSelProj(e.target.value)} style={styles.roleSelect}>
            <option value="">Select project…</option>
            {availableProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select value={selRole} onChange={(e) => setSelRole(e.target.value as ProjectRole)} style={styles.roleSelect}>
            <option value="project-admin">project-admin</option>
            <option value="editor">editor</option>
            <option value="reader">reader</option>
          </select>
          <button style={styles.primaryBtn} disabled={!selProj} onClick={assign}>Assign</button>
          <button style={styles.muteBtn} onClick={() => setShowAdd(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function AddUserModal(props: { onClose: () => void; onCreated: () => void }) {
  const api = useDashboardApi();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!email.trim() || !displayName.trim()) {
      setError('email and display name are required');
      return;
    }
    setSubmitting(true);
    try {
      await api.createUser({
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        password: password.length > 0 ? password : undefined,
      });
      props.onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.body : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.modalShell} onClick={props.onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>Add user</h2>
        <label style={styles.label}>Email
          <input style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@company.com" />
        </label>
        <label style={styles.label}>Display name
          <input style={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice Smith" />
        </label>
        <label style={styles.label}>Platform role
          <div style={styles.radioRow}>
            <label>
              <input type="radio" name="role" checked={role === 'user'} onChange={() => setRole('user')} /> User
            </label>
            <label>
              <input type="radio" name="role" checked={role === 'platform-admin'} onChange={() => setRole('platform-admin')} /> Platform admin
            </label>
          </div>
        </label>
        <label style={styles.label}>Password <span style={styles.muted}>(optional — for local auth; min 8 chars)</span>
          <input type="password" style={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="leave blank for IdP-only users" />
        </label>
        {error && <div style={styles.errorStrip}>✗ {error}</div>}
        <div style={styles.modalFooter}>
          <button style={styles.muteBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} disabled={submitting} onClick={submit}>
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Projects tab ─────────────────────────────────────────────────────────────

function ProjectsTab() {
  const api = useDashboardApi();
  const navigate = useNavigate();
  const { setCurrentProjectId, refresh: refreshContext } = useProject();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<Record<string, ProjectMember[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  async function reload() {
    try {
      const r = await api.listProjects();
      setProjects(r.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.body : String(err));
    }
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function expand(projectId: string) {
    if (expanded === projectId) {
      setExpanded(null);
      return;
    }
    setExpanded(projectId);
    if (!members[projectId]) {
      try {
        const r = await api.listMembers(projectId);
        setMembers((m) => ({ ...m, [projectId]: r.data }));
      } catch (err) {
        setError(err instanceof ApiError ? err.body : String(err));
      }
    }
  }

  function handleSwitch(p: ProjectSummary) {
    setCurrentProjectId(p.id);
    navigate('/');
  }
  function handleSettings(p: ProjectSummary) {
    navigate(`/projects/${p.id}/settings`);
  }

  const filtered = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  return (
    <div>
      {error && (
        <div style={styles.errorStrip}>✗ {error}<button style={styles.muteBtn} onClick={() => setError(null)}>dismiss</button></div>
      )}
      <div style={styles.toolbar}>
        <button style={styles.primaryBtn} onClick={() => setCreating(true)}>+ Create project</button>
        <input
          style={{ ...styles.input, maxWidth: '260px' }}
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Members</th>
              <th style={styles.th}>Intents</th>
              <th style={styles.th}>Last activity</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={styles.empty}>
                {projects.length === 0 ? 'No projects yet — click + Create project to register one' : 'No projects match your search'}
              </td></tr>
            )}
            {filtered.map((p) => (
              <React.Fragment key={p.id}>
                <tr style={styles.row}>
                  <td style={styles.td} onClick={() => void expand(p.id)}>{expanded === p.id ? '▼' : '▶'}</td>
                  <td style={styles.td} onClick={() => void expand(p.id)}>
                    <div>{p.name}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}><span style={styles.mono}>{p.gitUrl}</span></div>
                  </td>
                  <td style={styles.td}>{p.memberCount ?? '—'}</td>
                  <td style={styles.td}>{p.intentCount ?? '—'}</td>
                  <td style={styles.td}>{formatRelative(p.lastActivityAt)}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button style={styles.linkBtn} title="Open project settings" onClick={() => handleSettings(p)}>⚙</button>
                      <button style={styles.linkBtn} title="Switch to this project" onClick={() => handleSwitch(p)}>→</button>
                      <button style={styles.dangerBtn} title="Delete project" onClick={() => setDeleting(p)}>×</button>
                    </div>
                  </td>
                </tr>
                {expanded === p.id && (
                  <tr>
                    <td colSpan={6} style={styles.expanded}>
                      <MembersList
                        projectId={p.id}
                        members={members[p.id] ?? []}
                        onChanged={async () => {
                          const r = await api.listMembers(p.id);
                          setMembers((m) => ({ ...m, [p.id]: r.data }));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await reload();
            await refreshContext();
          }}
        />
      )}
      {deleting && (
        <DeleteProjectModal
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await reload();
            await refreshContext();
          }}
        />
      )}
    </div>
  );
}

function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function CreateProjectModal(props: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const api = useDashboardApi();
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [gitToken, setGitToken] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<'form' | 'registering' | 'initializing' | 'done'>('form');
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim() || !gitUrl.trim() || !gitToken) {
      setError('Name, Git URL, and Git token are required');
      return;
    }
    setStage('registering');
    try {
      const create = await api.createProject({
        name: name.trim(),
        gitUrl: gitUrl.trim(),
        defaultBranch: defaultBranch.trim() || 'main',
        gitToken,
      });
      setStage('initializing');
      const descToSend = description.trim()
        || `Project ${name.trim()} created via platform admin`;
      await api.initProjectHarness(create.data.id, { projectDescription: descToSend });
      setCreatedName(create.data.name);
      setStage('done');
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
      setStage('form');
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Create new project</h3>
        {error && <div style={styles.errorBanner}>{error}</div>}
        {stage === 'done' ? (
          <div>
            <p style={{ color: 'var(--green)' }}>✓ Project <code>{createdName}</code> created. Harness committed and pushed to {gitUrl}.</p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={styles.linkBtn} onClick={() => { void props.onCreated(); }}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <label style={styles.label}>Project name
              <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" autoFocus disabled={stage !== 'form'} />
            </label>
            <label style={styles.label}>Git repository URL
              <input style={styles.input} value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/org/repo.git" disabled={stage !== 'form'} />
            </label>
            <label style={styles.label}>Default branch
              <input style={styles.input} value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="main" disabled={stage !== 'form'} />
            </label>
            <label style={styles.label}>Git token (PAT)
              <input type="password" style={styles.input} value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="ghp_..." disabled={stage !== 'form'} />
              <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>Stored per-project (encrypt at rest is on the roadmap). Needs `repo` + `workflow` scope for GitHub.</span>
            </label>
            <label style={styles.label}>Description (optional)
              <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={`Project ${name || '<name>'} created via platform admin`} disabled={stage !== 'form'} />
            </label>
            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
              Template: <strong>★ Corporate Ops Web/Mobile</strong> (only template currently shipped)
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
              {stage === 'registering' && <span style={{ color: 'var(--text-dim)' }}>Registering project...</span>}
              {stage === 'initializing' && <span style={{ color: 'var(--text-dim)' }}>Cloning + writing harness...</span>}
              <button style={styles.linkBtn} onClick={props.onClose} disabled={stage !== 'form'}>Cancel</button>
              <button style={styles.primaryBtn} onClick={() => void submit()} disabled={stage !== 'form'}>
                Create project
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DeleteProjectModal(props: { project: ProjectSummary; onClose: () => void; onDeleted: () => Promise<void> | void }) {
  const api = useDashboardApi();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const matches = typed === props.project.name;

  async function submit() {
    if (!matches) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteProject(props.project.id);
      await props.onDeleted();
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const body = JSON.parse(err.body) as { code?: string; error?: string; activeIntents?: number };
          if (body.code === 'PROJECT_HAS_ACTIVE_INTENTS') {
            setError(`Cannot delete — this project has ${body.activeIntents ?? ''} active intents. Wait for them to complete or fail first.`);
          } else {
            setError(body.error ?? err.body);
          }
        } catch {
          setError(err.body);
        }
      } else {
        setError(String(err));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Delete project "{props.project.name}"?</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 4px' }}>
          This will permanently delete:
        </p>
        <ul style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '4px' }}>
          <li>{props.project.intentCount ?? 0} intents and their execution history</li>
          <li>{props.project.memberCount ?? 0} member assignments</li>
          <li>Git credentials and maintenance run history</li>
        </ul>
        <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          The Git repository itself will <strong>NOT</strong> be deleted.
        </p>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Type the project name to confirm:
          <input
            style={styles.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={props.project.name}
            autoFocus
            disabled={deleting}
          />
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose} disabled={deleting}>Cancel</button>
          <button
            style={matches ? styles.dangerBtn : { ...styles.dangerBtn, opacity: 0.4, cursor: 'not-allowed' }}
            onClick={() => void submit()}
            disabled={!matches || deleting}
          >
            {deleting ? 'Deleting...' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersList(props: { projectId: string; members: ProjectMember[]; onChanged: () => void | Promise<void> }) {
  const api = useDashboardApi();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selUser, setSelUser] = useState('');
  const [selRole, setSelRole] = useState<ProjectRole>('editor');

  useEffect(() => {
    api.listUsers().then((r) => setUsers(r.data)).catch(() => {});
  }, [api]);

  const memberSet = new Set(props.members.map((m) => m.userId));
  const candidates = users.filter((u) => !u.deactivatedAt && !memberSet.has(u.id));

  async function changeRole(userId: string, role: ProjectRole) {
    try {
      await api.updateMemberRole(props.projectId, userId, role);
      await props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }
  async function remove(userId: string) {
    if (!window.confirm('Remove this member?')) return;
    try {
      await api.removeMember(props.projectId, userId);
      await props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }
  async function add() {
    if (!selUser) return;
    try {
      await api.addMember(props.projectId, { userId: selUser, role: selRole });
      setShowAdd(false); setSelUser('');
      await props.onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body : String(err));
    }
  }

  return (
    <div style={styles.expandedInner}>
      <p style={styles.subhead}>Members</p>
      {props.members.length === 0 && <p style={styles.muted}>No members.</p>}
      {props.members.length > 0 && (
        <table style={styles.subtable}>
          <thead><tr><th style={styles.th}>Email</th><th style={styles.th}>Display name</th><th style={styles.th}>Role</th><th style={styles.th}></th></tr></thead>
          <tbody>
            {props.members.map((m) => (
              <tr key={m.userId}>
                <td style={styles.td}>{m.email}{m.platformRole === 'platform-admin' ? ' ★' : ''}</td>
                <td style={styles.td}>{m.displayName}</td>
                <td style={styles.td}>
                  <select value={m.projectRole} onChange={(e) => changeRole(m.userId, e.target.value as ProjectRole)} style={styles.roleSelect}>
                    <option value="project-admin">project-admin</option>
                    <option value="editor">editor</option>
                    <option value="reader">reader</option>
                  </select>
                </td>
                <td style={styles.td}>
                  <button style={styles.dangerBtn} onClick={() => remove(m.userId)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!showAdd && candidates.length > 0 && (
        <button style={styles.muteBtn} onClick={() => setShowAdd(true)}>+ Add member</button>
      )}
      {showAdd && (
        <div style={styles.inlineRow}>
          <select value={selUser} onChange={(e) => setSelUser(e.target.value)} style={styles.roleSelect}>
            <option value="">Select user…</option>
            {candidates.map((u) => (<option key={u.id} value={u.id}>{u.email}</option>))}
          </select>
          <select value={selRole} onChange={(e) => setSelRole(e.target.value as ProjectRole)} style={styles.roleSelect}>
            <option value="project-admin">project-admin</option>
            <option value="editor">editor</option>
            <option value="reader">reader</option>
          </select>
          <button style={styles.primaryBtn} disabled={!selUser} onClick={add}>Add</button>
          <button style={styles.muteBtn} onClick={() => setShowAdd(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── LLMs tab (Session 3) ────────────────────────────────────────────────────

const VALID_PROVIDERS = ['openai', 'azure-openai', 'anthropic', 'ollama', 'custom'] as const;
type ProviderId = typeof VALID_PROVIDERS[number];

const PROVIDER_PRESETS: Record<ProviderId, string> = {
  'openai':       'https://api.openai.com/v1',
  'azure-openai': '',  // operator supplies the deployment URL
  'anthropic':    'https://api.anthropic.com/v1',
  'ollama':       'http://localhost:11434/v1',
  'custom':       '',
};

function LlmsTab() {
  const api = useDashboardApi();
  const [llms, setLlms] = useState<PlatformLLM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformLLM | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, LlmTestResult>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await api.listPlatformLlms();
      setLlms(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleSetDefault(llm: PlatformLLM) {
    setError(null);
    try {
      await api.updatePlatformLlm(llm.id, { isDefault: true });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  async function handleDelete(llm: PlatformLLM) {
    if (!window.confirm(`Remove LLM '${llm.name}'?`)) return;
    setError(null);
    try {
      await api.deletePlatformLlm(llm.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  async function handleTest(llm: PlatformLLM) {
    setTesting(llm.id);
    setError(null);
    try {
      const res = await api.testPlatformLlm(llm.id);
      setTestResult((prev) => ({ ...prev, [llm.id]: res.data }));
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setTesting(null);
    }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading LLMs...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Platform LLMs ({llms.length})</h3>
        <button style={styles.primaryBtn} onClick={() => { setCreating(true); setEditing(null); }}>+ Add LLM</button>
      </div>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Provider</th>
            <th style={styles.th}>Model</th>
            <th style={styles.th}>Key source</th>
            <th style={styles.th}>Default</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {llms.map((l) => {
            const r = testResult[l.id];
            return (
              <tr key={l.id}>
                <td style={styles.td}>
                  {l.name}
                  {l.description && <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{l.description}</div>}
                </td>
                <td style={styles.td}>{l.provider}</td>
                <td style={styles.td} title={l.baseUrl}>{l.modelString}</td>
                <td style={styles.td}>{formatKeySource(l)}</td>
                <td style={styles.td}>{l.isDefault ? '★' : ''}</td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button style={styles.linkBtn} onClick={() => void handleTest(l)} disabled={testing === l.id}>
                      {testing === l.id ? 'Testing...' : 'Test'}
                    </button>
                    {r && (
                      <span style={r.ok ? styles.testOk : styles.testFail}>
                        {r.ok ? `✓ ${r.latencyMs}ms` : `✗ ${r.error?.slice(0, 30) ?? 'error'}`}
                      </span>
                    )}
                    <button style={styles.linkBtn} onClick={() => { setEditing(l); setCreating(false); }}>Edit</button>
                    {!l.isDefault && (
                      <button style={styles.linkBtn} onClick={() => void handleSetDefault(l)}>★ Set default</button>
                    )}
                    {!l.isDefault && (
                      <button style={styles.dangerBtn} onClick={() => void handleDelete(l)}>×</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(creating || editing) && (
        <LlmModal
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void load(); }}
          onError={(e) => setError(e)}
        />
      )}
    </div>
  );
}

function LlmModal(props: {
  existing: PlatformLLM | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const api = useDashboardApi();
  const [name, setName] = useState(props.existing?.name ?? '');
  const [provider, setProvider] = useState<ProviderId>((props.existing?.provider as ProviderId) ?? 'openai');
  const [modelString, setModelString] = useState(props.existing?.modelString ?? '');
  const [baseUrl, setBaseUrl] = useState(props.existing?.baseUrl ?? PROVIDER_PRESETS[(props.existing?.provider as ProviderId) ?? 'openai']);
  const [keySource, setKeySource] = useState<'vault' | 'env'>(
    props.existing?.secretId ? 'vault' : 'env',
  );
  const [secretId, setSecretId] = useState<string>(props.existing?.secretId ?? '');
  const [apiKeyEnv, setApiKeyEnv] = useState(props.existing?.apiKeyEnv ?? '');
  const [description, setDescription] = useState(props.existing?.description ?? '');
  const [isDefault, setIsDefault] = useState(props.existing?.isDefault ?? false);
  const [secrets, setSecrets] = useState<PlatformSecret[]>([]);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [creatingInlineSecret, setCreatingInlineSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listPlatformSecrets();
        if (!cancelled) setSecrets(res.data);
      } catch (err) {
        if (!cancelled) setSecretsError(err instanceof ApiError ? extractError(err) : String(err));
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProvider(p: ProviderId) {
    setProvider(p);
    // Only auto-fill if the baseUrl field is empty or matches the
    // previous provider's preset — operators who hand-edited the URL
    // shouldn't have it overwritten.
    const previousPreset = PROVIDER_PRESETS[provider];
    if (!baseUrl.trim() || baseUrl === previousPreset) {
      setBaseUrl(PROVIDER_PRESETS[p] ?? '');
    }
  }

  function saveDisabled(): boolean {
    if (saving) return true;
    if (!name.trim() || !modelString.trim() || !baseUrl.trim()) return true;
    if (keySource === 'vault') return !secretId;
    return !apiKeyEnv.trim();
  }

  async function save() {
    setSaving(true);
    try {
      // Build the body so the unused source's field is explicitly
      // null on update (clears any stale value), or omitted on create.
      const body = {
        name, provider, modelString, baseUrl,
        isDefault, description: description || null,
        ...(keySource === 'vault'
          ? { secretId, apiKeyEnv: null as string | null }
          : { apiKeyEnv, secretId: null as string | null }),
      };
      if (props.existing) {
        await api.updatePlatformLlm(props.existing.id, body);
      } else {
        // For create, omit the explicit-null entry so the server's
        // either-or validation sees only the active source.
        const createBody: Parameters<typeof api.createPlatformLlm>[0] = {
          name, provider, modelString, baseUrl,
          isDefault, description: description || null,
          ...(keySource === 'vault' ? { secretId } : { apiKeyEnv }),
        };
        await api.createPlatformLlm(createBody);
      }
      props.onSaved();
    } catch (err) {
      props.onError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleInlineSecretCreated(newSecret: PlatformSecret) {
    setSecrets((prev) => [newSecret, ...prev]);
    setSecretId(newSecret.id);
    setCreatingInlineSecret(false);
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>{props.existing ? `Edit ${props.existing.name}` : 'Add LLM'}</h3>
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="GPT-4o" />
        </label>
        <label style={styles.label}>Provider
          <select style={styles.select} value={provider} onChange={(e) => handleProvider(e.target.value as ProviderId)}>
            {VALID_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={styles.label}>Model string
          <input style={styles.input} value={modelString} onChange={(e) => setModelString(e.target.value)} placeholder="gpt-4o" />
        </label>
        <label style={styles.label}>Base URL
          <input style={styles.input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={PROVIDER_PRESETS[provider]} />
        </label>

        <div style={styles.sourceBlock}>
          <div style={styles.sourceHeader}>API key source</div>
          <label style={styles.radioRow}>
            <input
              type="radio"
              name="key-source"
              checked={keySource === 'vault'}
              onChange={() => setKeySource('vault')}
            />
            <span>Vault secret (recommended) — encrypted at rest</span>
          </label>
          {keySource === 'vault' && (
            <div style={styles.sourceBody}>
              {secretsError && <div style={styles.errorBanner}>{secretsError}</div>}
              {secrets.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '4px 0' }}>
                  No secrets in the vault yet. Create one to continue.
                </p>
              ) : (
                <select style={styles.select} value={secretId} onChange={(e) => setSecretId(e.target.value)}>
                  <option value="">— select a secret —</option>
                  {secrets.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ''}</option>
                  ))}
                </select>
              )}
              <button
                style={{ ...styles.linkBtn, padding: 0, marginTop: '6px' }}
                onClick={() => setCreatingInlineSecret(true)}
              >+ Create new secret</button>
            </div>
          )}
          <label style={styles.radioRow}>
            <input
              type="radio"
              name="key-source"
              checked={keySource === 'env'}
              onChange={() => setKeySource('env')}
            />
            <span>Environment variable (legacy)</span>
          </label>
          {keySource === 'env' && (
            <div style={styles.sourceBody}>
              <input
                style={styles.input}
                value={apiKeyEnv}
                onChange={(e) => setApiKeyEnv(e.target.value)}
                placeholder="OPENAI_API_KEY (env-var NAME, not value)"
              />
              <p style={{ color: 'var(--text-dim)', fontSize: '11px', margin: '4px 0 0' }}>
                The server reads the env value at LLM call time. Nothing is persisted in the registry.
              </p>
            </div>
          )}
        </div>

        <label style={styles.label}>Description (optional)
          <input style={styles.input} value={description ?? ''} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Set as platform default
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void save()} disabled={saveDisabled()}>
            {saving ? 'Saving...' : (props.existing ? 'Update' : 'Add LLM')}
          </button>
        </div>

        {creatingInlineSecret && (
          <AddSecretModal
            onClose={() => setCreatingInlineSecret(false)}
            onCreated={(s) => void handleInlineSecretCreated(s)}
          />
        )}
      </div>
    </div>
  );
}

function formatKeySource(llm: PlatformLLM): React.ReactNode {
  if (llm.secretId) {
    return <span style={{ color: 'var(--green)' }}>🔒 vault</span>;
  }
  if (llm.apiKeyEnv) {
    return <code style={{ color: 'var(--text-dim)' }}>env: {llm.apiKeyEnv}</code>;
  }
  return <span style={{ color: 'var(--red)' }}>(unset)</span>;
}

// ─── Secrets tab (Session 4 — migration 015) ─────────────────────────────────

function SecretsTab() {
  const api = useDashboardApi();
  const [secrets, setSecrets] = useState<PlatformSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformSecret | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listPlatformSecrets();
      setSecrets(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleDelete(s: PlatformSecret) {
    if (!window.confirm(`Remove secret '${s.name}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.deletePlatformSecret(s.id);
      await load();
    } catch (err) {
      // Surface the SECRET_IN_USE error with the list of referencing LLMs
      if (err instanceof ApiError) {
        try {
          const body = JSON.parse(err.message) as { code?: string; llmNames?: string[]; error?: string };
          if (body.code === 'SECRET_IN_USE' && body.llmNames) {
            setError(`Cannot remove: secret is used by LLM(s) ${body.llmNames.join(', ')}. Edit each LLM first to switch its key source.`);
            return;
          }
          setError(body.error ?? err.message);
          return;
        } catch {
          setError(err.message);
          return;
        }
      }
      setError(String(err));
    }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading secrets...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Encrypted secrets vault ({secrets.length})</h3>
        <button style={styles.primaryBtn} onClick={() => { setCreating(true); setEditing(null); }}>+ Add secret</button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        Secret values are encrypted with the server's master key (AES-256-GCM) and are never displayed
        after they are saved. To replace a value, use <em>Rotate</em>.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Description</th>
            <th style={styles.th}>Created</th>
            <th style={styles.th}>Updated</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {secrets.length === 0 && (
            <tr><td colSpan={5} style={styles.empty}>No secrets stored yet</td></tr>
          )}
          {secrets.map((s) => (
            <tr key={s.id}>
              <td style={styles.td}><code>{s.name}</code></td>
              <td style={styles.td}>{s.description ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
              <td style={styles.td}>{formatDate(s.createdAt)}</td>
              <td style={styles.td}>{formatDate(s.updatedAt)}</td>
              <td style={styles.td}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={styles.linkBtn} onClick={() => { setEditing(s); setCreating(false); }}>Edit / rotate</button>
                  <button style={styles.dangerBtn} onClick={() => void handleDelete(s)}>×</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating && (
        <AddSecretModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load(); }}
        />
      )}
      {editing && (
        <EditSecretModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function AddSecretModal(props: {
  onClose: () => void;
  onCreated: (secret: PlatformSecret) => void;
}) {
  const api = useDashboardApi();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim() || !value) { setError('Name and value are required'); return; }
    if (value !== confirmValue) { setError('Values do not match'); return; }
    setSaving(true);
    try {
      const res = await api.createPlatformSecret({ name: name.trim(), value, description: description.trim() || null });
      props.onCreated(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Add secret</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: 0 }}>
          The value is encrypted at rest and will not be shown again after you save.
        </p>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="openai-prod-key" autoFocus />
        </label>
        <label style={styles.label}>Description (optional)
          <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Production OpenAI API key" />
        </label>
        <label style={styles.label}>Secret value
          <input type="password" style={styles.input} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label style={styles.label}>Confirm value
          <input type="password" style={styles.input} value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void save()} disabled={saving || !name.trim() || !value || value !== confirmValue}>
            {saving ? 'Saving...' : 'Save secret'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditSecretModal(props: {
  existing: PlatformSecret;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useDashboardApi();
  const [name, setName] = useState(props.existing.name);
  const [description, setDescription] = useState(props.existing.description ?? '');
  const [newValue, setNewValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (newValue && newValue !== confirmValue) {
      setError('Values do not match');
      return;
    }
    setSaving(true);
    try {
      const body: Partial<{ name: string; value: string; description: string | null }> = {};
      if (name.trim() !== props.existing.name) body.name = name.trim();
      if ((description.trim() || null) !== props.existing.description) body.description = description.trim() || null;
      if (newValue) body.value = newValue;
      if (Object.keys(body).length === 0) { props.onClose(); return; }
      await api.updatePlatformSecret(props.existing.id, body);
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Edit secret</h3>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={styles.label}>Description
          <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div style={styles.sourceBlock}>
          <div style={styles.sourceHeader}>Rotate value (optional)</div>
          <p style={{ color: 'var(--text-dim)', fontSize: '11px', margin: '0 0 6px' }}>
            Leave both fields blank to keep the current value. Setting a new value is irreversible — the old value cannot be recovered.
          </p>
          <label style={styles.label}>New value
            <input type="password" style={styles.input} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </label>
          <label style={styles.label}>Confirm new value
            <input type="password" style={styles.input} value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Groups tab (Brief 1 — bulk user management, migration 018) ─────────────

function GroupsTab() {
  const api = useDashboardApi();
  const [groups, setGroups] = useState<PlatformGroup[]>([]);
  // Per-group member + assignment counts populated lazily once the
  // group is expanded — the list endpoint doesn't carry them.
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});
  const [managing, setManaging] = useState<PlatformGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listPlatformGroups();
      setGroups(res.data);
      // Eager fetch of counts so the table can show "5 / 2" without
      // requiring a click. Cheap — each group's lookup is two
      // indexed queries.
      const counts: { mem: Record<string, number>; proj: Record<string, number> } = { mem: {}, proj: {} };
      await Promise.all(res.data.map(async (g) => {
        try {
          const [m, p] = await Promise.all([
            api.listGroupMembers(g.id),
            api.listGroupProjectAssignments(g.id),
          ]);
          counts.mem[g.id] = m.data.length;
          counts.proj[g.id] = p.data.length;
        } catch { /* leave undefined */ }
      }));
      setMemberCounts(counts.mem);
      setProjectCounts(counts.proj);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleDelete(g: PlatformGroup) {
    if (!window.confirm(`Delete group '${g.name}'? Members keep their direct memberships; only group-derived project access is removed.`)) return;
    setError(null);
    try { await api.deletePlatformGroup(g.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading groups...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Platform groups ({groups.length})</h3>
        <button style={styles.primaryBtn} onClick={() => setCreating(true)}>+ Create group</button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        Groups let you assign multiple users to multiple projects at once. A member's effective role on a
        project is the higher of their direct membership AND any group-derived role.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Members</th>
            <th style={styles.th}>Projects</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={4} style={styles.empty}>No groups yet — click + Create group to start</td></tr>
          )}
          {groups.map((g) => (
            <tr key={g.id}>
              <td style={styles.td}>
                {g.name}
                {g.description && <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{g.description}</div>}
              </td>
              <td style={styles.td}>{memberCounts[g.id] ?? '—'}</td>
              <td style={styles.td}>{projectCounts[g.id] ?? '—'}</td>
              <td style={styles.td}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={styles.linkBtn} onClick={() => setManaging(g)}>Manage</button>
                  <button style={styles.dangerBtn} onClick={() => void handleDelete(g)}>×</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating && (
        <CreateGroupModal
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); }}
        />
      )}
      {managing && (
        <ManageGroupPanel
          group={managing}
          onClose={() => setManaging(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function CreateGroupModal(props: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const api = useDashboardApi();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      await api.createPlatformGroup({ name: name.trim(), description: description.trim() || null });
      await props.onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally { setSaving(false); }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Create group</h3>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend Team" autoFocus />
        </label>
        <label style={styles.label}>Description (optional)
          <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageGroupPanel(props: {
  group: PlatformGroup;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useDashboardApi();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [assignments, setAssignments] = useState<GroupProjectAssignment[]>([]);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(props.group.name);
  const [draftDescription, setDraftDescription] = useState(props.group.description ?? '');

  async function reload() {
    try {
      const [m, p, u, projRes] = await Promise.all([
        api.listGroupMembers(props.group.id),
        api.listGroupProjectAssignments(props.group.id),
        api.listUsers(),
        api.listProjects(),
      ]);
      setMembers(m.data);
      setAssignments(p.data);
      setAllUsers(u.data);
      setAllProjects(projRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [props.group.id]);

  async function saveName() {
    setError(null);
    try {
      await api.updatePlatformGroup(props.group.id, {
        name: draftName.trim(),
        description: draftDescription.trim() || null,
      });
      setEditingName(false);
      props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  async function removeMember(userId: string) {
    setError(null);
    try { await api.removeGroupMember(props.group.id, userId); await reload(); props.onChanged(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }
  async function removeAssignment(projectId: string) {
    setError(null);
    try { await api.unassignGroupFromProject(props.group.id, projectId); await reload(); props.onChanged(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }
  async function changeAssignmentRole(projectId: string, role: 'project-admin' | 'editor' | 'reader') {
    setError(null);
    try { await api.assignGroupToProject(props.group.id, projectId, role); await reload(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }

  const memberUserIds = new Set(members.map((m) => m.userId));
  const assignedProjectIds = new Set(assignments.map((a) => a.projectId));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));
  const availableProjects = allProjects.filter((p) => !assignedProjectIds.has(p.id));

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {editingName ? (
            <div style={{ flex: 1, display: 'flex', gap: '6px' }}>
              <input style={styles.input} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              <input style={styles.input} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} placeholder="Description (optional)" />
              <button style={styles.primaryBtn} onClick={() => void saveName()}>Save</button>
              <button style={styles.linkBtn} onClick={() => { setEditingName(false); setDraftName(props.group.name); setDraftDescription(props.group.description ?? ''); }}>Cancel</button>
            </div>
          ) : (
            <h3 style={styles.cardTitle}>{props.group.name}</h3>
          )}
          {!editingName && (
            <button style={styles.linkBtn} onClick={() => setEditingName(true)}>Edit name</button>
          )}
        </div>
        {props.group.description && !editingName && (
          <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '4px 0 0' }}>{props.group.description}</p>
        )}
        {error && <div style={styles.errorBanner}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Members ({members.length})</strong>
          <button style={styles.linkBtn} onClick={() => setAddingMember((v) => !v)}>+ Add member</button>
        </div>
        {addingMember && (
          <AddMemberRow
            users={availableUsers}
            onCancel={() => setAddingMember(false)}
            onAdd={async (userId) => {
              try { await api.addGroupMember(props.group.id, userId); setAddingMember(false); await reload(); props.onChanged(); }
              catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
            }}
          />
        )}
        <table style={{ ...styles.subtable, marginTop: '6px' }}>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={3} style={styles.empty}>No members yet</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.userId}>
                <td style={styles.td}><code>{m.user.email}</code></td>
                <td style={styles.td}>{m.user.displayName}</td>
                <td style={styles.td}>
                  <button style={styles.dangerBtn} onClick={() => void removeMember(m.userId)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Project assignments ({assignments.length})</strong>
          <button style={styles.linkBtn} onClick={() => setAddingProject((v) => !v)}>+ Assign to project</button>
        </div>
        {addingProject && (
          <AddProjectAssignmentRow
            projects={availableProjects}
            onCancel={() => setAddingProject(false)}
            onAdd={async (projectId, role) => {
              try { await api.assignGroupToProject(props.group.id, projectId, role); setAddingProject(false); await reload(); props.onChanged(); }
              catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
            }}
          />
        )}
        <table style={{ ...styles.subtable, marginTop: '6px' }}>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={3} style={styles.empty}>No project assignments yet</td></tr>
            )}
            {assignments.map((a) => (
              <tr key={a.projectId}>
                <td style={styles.td}>{a.project.name}</td>
                <td style={styles.td}>
                  <select
                    style={styles.select}
                    value={a.role}
                    onChange={(e) => void changeAssignmentRole(a.projectId, e.target.value as 'project-admin' | 'editor' | 'reader')}
                  >
                    <option value="reader">Reader</option>
                    <option value="editor">Editor</option>
                    <option value="project-admin">Project admin</option>
                  </select>
                </td>
                <td style={styles.td}>
                  <button style={styles.dangerBtn} onClick={() => void removeAssignment(a.projectId)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AddMemberRow(props: {
  users: UserSummary[];
  onAdd: (userId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState('');
  return (
    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
      <select style={{ ...styles.select, flex: 1 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">— pick a user —</option>
        {props.users.map((u) => (
          <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
        ))}
      </select>
      <button style={styles.primaryBtn} disabled={!userId} onClick={() => void props.onAdd(userId)}>Add</button>
      <button style={styles.linkBtn} onClick={props.onCancel}>Cancel</button>
    </div>
  );
}

function AddProjectAssignmentRow(props: {
  projects: ProjectSummary[];
  onAdd: (projectId: string, role: 'project-admin' | 'editor' | 'reader') => Promise<void> | void;
  onCancel: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<'project-admin' | 'editor' | 'reader'>('editor');
  return (
    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
      <select style={{ ...styles.select, flex: 2 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">— pick a project —</option>
        {props.projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select style={{ ...styles.select, flex: 1 }} value={role} onChange={(e) => setRole(e.target.value as 'project-admin' | 'editor' | 'reader')}>
        <option value="reader">Reader</option>
        <option value="editor">Editor</option>
        <option value="project-admin">Project admin</option>
      </select>
      <button style={styles.primaryBtn} disabled={!projectId} onClick={() => void props.onAdd(projectId, role)}>Assign</button>
      <button style={styles.linkBtn} onClick={props.onCancel}>Cancel</button>
    </div>
  );
}

function extractError(err: ApiError): string {
  // The constructor stores the JSON body as `err.body`; `err.message`
  // is the "API error N: <body>" prefix. Parse body first.
  try {
    const p = JSON.parse(err.body) as { error?: string };
    return p.error ?? err.body;
  } catch { /* not JSON */ }
  try {
    const p = JSON.parse(err.message) as { error?: string };
    return p.error ?? err.message;
  } catch { return err.message; }
}

// ─── Templates tab (Session 3 — migration 017) ───────────────────────────────

function TemplatesTab() {
  const api = useDashboardApi();
  const [rows, setRows] = useState<PlatformTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listPlatformTemplates();
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleSetDefault(t: PlatformTemplateSummary) {
    setError(null);
    try { await api.setDefaultPlatformTemplate(t.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }
  async function handleDelete(t: PlatformTemplateSummary) {
    if (!window.confirm(`Delete template '${t.name}'?`)) return;
    setError(null);
    try { await api.deletePlatformTemplate(t.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading templates...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Project templates ({rows.length})</h3>
        <button style={styles.primaryBtn} onClick={() => setUploading(true)}>+ Upload template</button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        Built-in templates ship with the platform and cannot be deleted. Custom templates can be
        set as default — the default is used by `gestalt init` for every new project.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Slug</th>
            <th style={styles.th}>Tier</th>
            <th style={styles.th}>Version</th>
            <th style={styles.th}>Default</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={styles.empty}>No templates registered yet</td></tr>
          )}
          {rows.map((t) => (
            <tr key={t.id}>
              <td style={styles.td}>
                {t.name}
                {t.description && <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{t.description}</div>}
              </td>
              <td style={styles.td}><code>{t.slug}</code></td>
              <td style={styles.td}>{t.tier}{t.isBuiltin ? ' (built-in)' : ''}</td>
              <td style={styles.td}>{t.version}</td>
              <td style={styles.td}>{t.isDefault ? '★' : ''}</td>
              <td style={styles.td}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {!t.isDefault && (
                    <button style={styles.linkBtn} onClick={() => void handleSetDefault(t)}>★ Set default</button>
                  )}
                  {!t.isBuiltin && (
                    <button style={styles.dangerBtn} onClick={() => void handleDelete(t)}>×</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {uploading && (
        <UploadTemplateModal
          onClose={() => setUploading(false)}
          onUploaded={async () => { setUploading(false); await load(); }}
        />
      )}
    </div>
  );
}

function UploadTemplateModal(props: { onClose: () => void; onUploaded: () => Promise<void> | void }) {
  const api = useDashboardApi();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState('Custom');
  const [version, setVersion] = useState('1.0.0');
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const REQUIRED_BASENAMES = ['AGENTS.md', 'HARNESS.json', 'agents.yaml'];

  async function handleZip(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const extracted: Record<string, string> = {};
      await Promise.all(Object.entries(zip.files).map(async ([path, entry]) => {
        if ((entry as { dir: boolean }).dir) return;
        extracted[path] = await (entry as { async: (t: string) => Promise<string> }).async('string');
      }));
      setFiles(extracted);
      setFileNames(Object.keys(extracted).sort());
      const basenames = new Set(Object.keys(extracted).map((p) => p.split('/').pop() ?? p));
      setMissing(REQUIRED_BASENAMES.filter((b) => !basenames.has(b)));
    } catch (err) {
      setError(`Failed to read ZIP: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim() || !slug.trim()) { setError('Name and slug are required'); return; }
    if (!files || Object.keys(files).length === 0) { setError('Upload a ZIP first'); return; }
    if (missing.length > 0) {
      setError(`Template is missing required files: ${missing.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      await api.createPlatformTemplate({
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim() || null,
        tier: tier.trim() || 'custom',
        version: version.trim() || '0.1.0',
        files,
        variables: [],
      });
      await props.onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Upload template</h3>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Custom Template" />
        </label>
        <label style={styles.label}>Slug (lowercase, kebab-case)
          <input style={styles.input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-custom-template" />
        </label>
        <label style={styles.label}>Description (optional)
          <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <label style={{ ...styles.label, flex: 1 }}>Tier
            <input style={styles.input} value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Tier 1 / Custom" />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>Version
            <input style={styles.input} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
          </label>
        </div>
        <label style={styles.label}>Template ZIP
          <input type="file" accept=".zip" onChange={(e) => void handleZip(e)} style={styles.input} />
        </label>
        {fileNames.length > 0 && (
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            <strong>{fileNames.length} files extracted:</strong>
            <ul style={{ maxHeight: '120px', overflow: 'auto', margin: '4px 0', padding: '0 0 0 16px' }}>
              {fileNames.slice(0, 12).map((p) => <li key={p}><code>{p}</code></li>)}
              {fileNames.length > 12 && <li>... and {fileNames.length - 12} more</li>}
            </ul>
            {missing.length > 0 && (
              <div style={{ color: 'var(--red)' }}>
                ⚠ Missing required files: {missing.join(', ')}
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void submit()} disabled={submitting || !files || missing.length > 0}>
            {submitting ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MCP Servers tab (Session 3 — migration 017) ─────────────────────────────

function McpServersTab() {
  const api = useDashboardApi();
  const [rows, setRows] = useState<PlatformMcpServer[]>([]);
  const [secrets, setSecrets] = useState<PlatformSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformMcpServer | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, PlatformMcpTestResult>>({});

  async function load() {
    setLoading(true);
    try {
      const [serversRes, secretsRes] = await Promise.all([
        api.listPlatformMcpServers(),
        api.listPlatformSecrets(),
      ]);
      setRows(serversRes.data);
      setSecrets(secretsRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleTest(s: PlatformMcpServer) {
    setTesting(s.id);
    try {
      const res = await api.testPlatformMcpServer(s.id);
      setTestResult((prev) => ({ ...prev, [s.id]: res.data }));
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally { setTesting(null); }
  }
  async function handleDelete(s: PlatformMcpServer) {
    if (!window.confirm(`Remove MCP server '${s.name}'?`)) return;
    setError(null);
    try { await api.deletePlatformMcpServer(s.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }
  async function handleToggle(s: PlatformMcpServer) {
    setError(null);
    try { await api.updatePlatformMcpServer(s.id, { enabled: !s.enabled }); await load(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading MCP servers...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Platform MCP servers ({rows.length})</h3>
        <button style={styles.primaryBtn} onClick={() => { setCreating(true); setEditing(null); }}>+ Add MCP server</button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        Platform-level MCP servers are merged with project-level ones (declared in agents.yaml). Each
        server is enabled per-cycle to all agents OR filtered to a specific set of agent roles.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>URL</th>
            <th style={styles.th}>Agents</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} style={styles.empty}>No MCP servers configured</td></tr>
          )}
          {rows.map((s) => {
            const r = testResult[s.id];
            return (
              <tr key={s.id}>
                <td style={styles.td}>
                  {s.name}
                  {s.description && <div style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{s.description}</div>}
                </td>
                <td style={styles.td}><code style={{ fontSize: '11px' }}>{s.url}</code></td>
                <td style={styles.td}>{s.agentRoles.length === 0 ? 'all' : s.agentRoles.join(', ')}</td>
                <td style={styles.td}>
                  <span style={{ color: s.enabled ? 'var(--green)' : 'var(--text-dim)' }}>
                    {s.enabled ? '● enabled' : '○ disabled'}
                  </span>
                </td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button style={styles.linkBtn} disabled={testing === s.id} onClick={() => void handleTest(s)}>
                      {testing === s.id ? 'Testing...' : 'Test'}
                    </button>
                    {r && (
                      <span style={r.ok ? styles.testOk : styles.testFail}>
                        {r.ok ? `✓ ${r.toolCount} tools (${r.latencyMs}ms)` : `✗ ${r.error?.slice(0, 24) ?? 'error'}`}
                      </span>
                    )}
                    <button style={styles.linkBtn} onClick={() => void handleToggle(s)}>
                      {s.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button style={styles.linkBtn} onClick={() => { setEditing(s); setCreating(false); }}>Edit</button>
                    <button style={styles.dangerBtn} onClick={() => void handleDelete(s)}>×</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(creating || editing) && (
        <McpServerModal
          existing={editing}
          secrets={secrets}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function McpServerModal(props: {
  existing: PlatformMcpServer | null;
  secrets: PlatformSecret[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const api = useDashboardApi();
  const [name, setName] = useState(props.existing?.name ?? '');
  const [url, setUrl] = useState(props.existing?.url ?? '');
  const [description, setDescription] = useState(props.existing?.description ?? '');
  const [secretId, setSecretId] = useState(props.existing?.secretId ?? '');
  const [enabled, setEnabled] = useState(props.existing?.enabled ?? true);
  const [agentRolesText, setAgentRolesText] = useState((props.existing?.agentRoles ?? []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim() || !url.trim()) { setError('Name and URL are required'); return; }
    const agentRoles = agentRolesText.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || null,
        secretId: secretId || null,
        enabled,
        agentRoles,
      };
      if (props.existing) {
        await api.updatePlatformMcpServer(props.existing.id, body);
      } else {
        await api.createPlatformMcpServer(body);
      }
      await props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally { setSubmitting(false); }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>{props.existing ? `Edit ${props.existing.name}` : 'Add MCP server'}</h3>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <label style={styles.label}>Name
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
        </label>
        <label style={styles.label}>URL
          <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/v1 or stdio:./mcp-server" />
        </label>
        <label style={styles.label}>Description (optional)
          <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label style={styles.label}>Bearer token secret (vault)
          <select style={styles.select} value={secretId} onChange={(e) => setSecretId(e.target.value)}>
            <option value="">— Anonymous —</option>
            {props.secrets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={styles.label}>Agent roles (comma-separated; blank = all agents)
          <input style={styles.input} value={agentRolesText} onChange={(e) => setAgentRolesText(e.target.value)} placeholder="code-agent, review-agent" />
        </label>
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => void save()} disabled={submitting || !name.trim() || !url.trim()}>
            {submitting ? 'Saving...' : (props.existing ? 'Update' : 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tools tab (Session 3 — read-only informational) ─────────────────────────

function ToolsTab() {
  const api = useDashboardApi();
  const [tools, setTools] = useState<PlatformToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listPlatformTools();
        setTools(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? extractError(err) : String(err));
      } finally { setLoading(false); }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Loading tools...</p>;

  return (
    <div>
      <h3 style={styles.cardTitle}>Built-in tools ({tools.length})</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        These tools are available to agents for reading project files. Configure per-agent in
        Project Settings → Agents. To add MCP tools (server-issued), use Platform MCP Servers above.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {tools.map((t) => (
          <div key={t.name} style={{ ...styles.card, padding: '12px 14px' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => setExpanded(expanded === t.name ? null : t.name)}
            >
              <div>
                <code style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{t.name}</code>
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', marginTop: '2px' }}>
                  {t.description}
                </div>
              </div>
              <span style={{ color: 'var(--text-dim)' }}>{expanded === t.name ? '▼' : '▶'}</span>
            </div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-dim)' }}>
              Default agents: {t.defaultAgents.length > 0 ? t.defaultAgents.join(', ') : 'none'}
            </div>
            {expanded === t.name && (
              <pre style={{ background: 'var(--bg-subtle)', borderRadius: '4px', padding: '8px', fontSize: '11px', overflow: 'auto', margin: '8px 0 0' }}>
{JSON.stringify(t.inputSchema, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Identity tab (Session 3 — migration 017) ────────────────────────────────

function IdentityTab() {
  const api = useDashboardApi();
  const [state, setState] = useState<IdentityState | null>(null);
  const [secrets, setSecrets] = useState<PlatformSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadStatus, setReloadStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<IdentityProvider | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [idRes, secRes] = await Promise.all([
        api.getPlatformIdentity(),
        api.listPlatformSecrets(),
      ]);
      setState(idRes.data);
      setSecrets(secRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleReload() {
    setReloadStatus('Reloading...');
    try {
      const res = await api.reloadIdentity();
      setReloadStatus(`✓ Active providers: ${res.data.providers.join(', ') || 'local'}`);
      await load();
      setTimeout(() => setReloadStatus(null), 4000);
    } catch (err) {
      setReloadStatus(`✗ ${err instanceof ApiError ? extractError(err) : String(err)}`);
    }
  }

  if (loading || !state) return <p style={{ color: 'var(--text-dim)' }}>Loading identity config...</p>;

  const findProvider = (p: IdentityProvider) => state.providers.find((x) => x.provider === p) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={styles.cardTitle}>Corporate identity</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {reloadStatus && <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{reloadStatus}</span>}
          <button style={styles.linkBtn} onClick={() => void handleReload()}>Reload</button>
        </div>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 12px' }}>
        Active providers: {state.activeProviders.length > 0 ? state.activeProviders.join(', ') : 'local only'}.
        Sensitive fields (certificates, client secrets, keytabs) live in the secrets vault — only the
        reference id is stored in the identity config.
      </p>
      {error && <div style={styles.errorBanner}>{error}</div>}

      {(['kerberos', 'saml', 'oidc'] as const).map((providerType) => (
        <IdentityProviderCard
          key={providerType}
          providerType={providerType}
          existing={findProvider(providerType)}
          secrets={secrets}
          expanded={expanded === providerType}
          onToggleExpand={() => setExpanded(expanded === providerType ? null : providerType)}
          onSaved={() => void load()}
        />
      ))}

      <h3 style={{ ...styles.cardTitle, marginTop: '20px' }}>Role mappings</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '0 0 8px' }}>
        IdP group names that map to a platform role. Members of these groups get the role on their
        next login.
      </p>
      <RoleMappingList mappings={state.roleMappings} onChanged={() => void load()} />
    </div>
  );
}

function IdentityProviderCard(props: {
  providerType: IdentityProvider;
  existing: { id: string; enabled: boolean; config: Record<string, unknown> } | null;
  secrets: PlatformSecret[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSaved: () => void;
}) {
  const api = useDashboardApi();
  const enabled = props.existing?.enabled ?? false;
  const [cfgText, setCfgText] = useState(() => JSON.stringify(props.existing?.config ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCfgText(JSON.stringify(props.existing?.config ?? {}, null, 2));
  }, [props.existing]);

  async function handleToggleEnabled() {
    setError(null);
    try {
      await api.patchIdentityProvider(props.providerType, { enabled: !enabled });
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  async function save() {
    setError(null);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cfgText) as Record<string, unknown>; }
    catch (err) { setError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`); return; }
    setSaving(true);
    try {
      await api.patchIdentityProvider(props.providerType, { config: parsed });
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    } finally { setSaving(false); }
  }

  return (
    <div style={{ ...styles.card, padding: '12px 14px', marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={props.onToggleExpand}>
        <div>
          <strong style={{ color: 'var(--text-primary)' }}>
            {props.providerType === 'kerberos' && 'Kerberos / SPNEGO'}
            {props.providerType === 'saml' && 'SAML 2.0'}
            {props.providerType === 'oidc' && 'OIDC'}
          </strong>
          {enabled ? <span style={{ color: 'var(--green)', marginLeft: '8px' }}>● enabled</span> : <span style={{ color: 'var(--text-dim)', marginLeft: '8px' }}>○ disabled</span>}
        </div>
        <span style={{ color: 'var(--text-dim)' }}>{props.expanded ? '▼' : '▶'}</span>
      </div>
      {props.expanded && (
        <div style={{ marginTop: '10px' }}>
          {error && <div style={styles.errorBanner}>{error}</div>}
          <p style={{ color: 'var(--text-dim)', fontSize: '11px', margin: '0 0 6px' }}>
            Sensitive fields must be supplied as <code>*SecretId</code> references — pick a vault
            secret name from the list below and paste its UUID into the appropriate field.
            Vault secrets:{' '}
            {props.secrets.length > 0
              ? props.secrets.map((s) => <span key={s.id} title={s.id}><code>{s.name}</code> </span>)
              : <em>none yet — add one in the Secrets tab</em>}
          </p>
          <label style={styles.label}>Config (JSON)
            <textarea
              style={{ ...styles.input, fontFamily: 'var(--font-mono)', fontSize: '11px', minHeight: '160px' }}
              value={cfgText}
              onChange={(e) => setCfgText(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button style={styles.linkBtn} onClick={() => void handleToggleEnabled()}>{enabled ? 'Disable' : 'Enable'}</button>
            <button style={styles.primaryBtn} onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save config'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleMappingList(props: { mappings: RoleMapping[]; onChanged: () => void }) {
  const api = useDashboardApi();
  const [adding, setAdding] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [role, setRole] = useState<'platform-admin' | 'user'>('platform-admin');
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!groupName.trim()) { setError('Group name is required'); return; }
    try {
      await api.addRoleMapping({ groupName: groupName.trim(), platformRole: role });
      setGroupName(''); setAdding(false); props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? extractError(err) : String(err));
    }
  }
  async function remove(m: RoleMapping) {
    if (!window.confirm(`Remove mapping for '${m.groupName}'?`)) return;
    try { await api.removeRoleMapping(m.id); props.onChanged(); }
    catch (err) { setError(err instanceof ApiError ? extractError(err) : String(err)); }
  }

  return (
    <div>
      {error && <div style={styles.errorBanner}>{error}</div>}
      {!adding && <button style={styles.primaryBtn} onClick={() => setAdding(true)}>+ Add mapping</button>}
      {adding && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
          <label style={{ ...styles.label, flex: 2 }}>Group name
            <input style={styles.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="gestalt-admins" />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>Role
            <select style={styles.select} value={role} onChange={(e) => setRole(e.target.value as 'platform-admin' | 'user')}>
              <option value="platform-admin">Platform admin</option>
              <option value="user">User</option>
            </select>
          </label>
          <button style={styles.primaryBtn} onClick={() => void add()}>Add</button>
          <button style={styles.linkBtn} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      <table style={{ ...styles.table, marginTop: '8px' }}>
        <thead><tr><th style={styles.th}>Group name</th><th style={styles.th}>Platform role</th><th style={styles.th}></th></tr></thead>
        <tbody>
          {props.mappings.length === 0 && (
            <tr><td colSpan={3} style={styles.empty}>No role mappings configured</td></tr>
          )}
          {props.mappings.map((m) => (
            <tr key={m.id}>
              <td style={styles.td}><code>{m.groupName}</code></td>
              <td style={styles.td}>{m.platformRole}</td>
              <td style={styles.td}><button style={styles.dangerBtn} onClick={() => void remove(m)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '28px 32px', maxWidth: '1100px' },
  header: { marginBottom: '20px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' },
  subtitle: { margin: '4px 0 0 0', color: 'var(--text-dim)', fontSize: '13px' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: '4px', borderBottom: '1px solid var(--border)', marginBottom: '16px' },
  tab: {
    background: 'transparent', border: 'none', padding: '8px 14px',
    fontSize: '13px', color: 'var(--text-secondary)',
    borderBottom: '2px solid transparent', marginBottom: '-1px', cursor: 'pointer',
  },
  tabActive: { color: 'var(--text-primary)', borderBottomColor: 'var(--accent)' },
  toolbar: { display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' },
  searchBox: {
    flex: 1, maxWidth: '300px',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: '5px', padding: '6px 10px', color: 'var(--text-primary)',
    fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none',
  },
  card: {
    background: 'var(--bg-raised)', border: '1px solid var(--border)',
    borderRadius: '6px', overflow: 'hidden',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  subtable: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '8px' },
  th: { textAlign: 'left', padding: '10px 12px', color: 'var(--text-dim)', fontWeight: 500, borderBottom: '1px solid var(--border)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' },
  row: { cursor: 'pointer' },
  empty: { padding: '20px', textAlign: 'center', color: 'var(--text-dim)' },
  expanded: { background: 'var(--bg-subtle)', padding: '12px 18px' },
  expandedInner: { padding: '4px 0' },
  subhead: { margin: '0 0 8px 0', fontWeight: 500, fontSize: '12px', color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-dim)', fontSize: '12px' },
  active: { color: 'var(--green)' },
  deactivated: { color: 'var(--text-dim)' },
  mono: { fontFamily: 'var(--font-mono)', fontSize: '11px' },
  adminBadge: {
    background: 'var(--accent)', color: '#fff',
    border: 'none', padding: '3px 8px', borderRadius: '4px',
    fontSize: '11px', cursor: 'pointer',
  },
  userBadge: {
    background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', padding: '3px 8px', borderRadius: '4px',
    fontSize: '11px', cursor: 'pointer',
  },
  primaryBtn: {
    background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: '5px', padding: '6px 12px',
    fontSize: '12px', cursor: 'pointer',
  },
  muteBtn: {
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: '5px',
    padding: '5px 10px', fontSize: '12px', cursor: 'pointer',
  },
  dangerBtn: {
    background: 'transparent', color: 'var(--red)',
    border: '1px solid var(--red)', borderRadius: '5px',
    padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
  },
  roleSelect: {
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: '4px', padding: '4px 8px', fontSize: '12px',
    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
    outline: 'none',
  },
  inlineRow: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' },
  errorStrip: {
    background: 'rgba(220, 38, 38, 0.1)', color: 'var(--red)',
    padding: '8px 12px', borderRadius: '5px', marginBottom: '12px',
    fontSize: '12px', display: 'flex', alignItems: 'center', gap: '12px',
  },
  modalShell: {
    position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: 'var(--bg-raised)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '24px', minWidth: '380px', maxWidth: '460px',
  },
  modalTitle: { margin: '0 0 14px 0', fontSize: '16px', color: 'var(--text-primary)' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' },
  label: { display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '12px' },
  input: {
    width: '100%', boxSizing: 'border-box', marginTop: '4px',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: '5px', padding: '6px 10px', fontSize: '13px',
    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', outline: 'none',
  },
  radioRow: { display: 'flex', gap: '14px', marginTop: '4px', color: 'var(--text-primary)', fontSize: '13px' },
  // Session 3 — LLMs tab additions
  cardTitle: { margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' },
  linkBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: '4px', padding: '4px 10px',
    fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer',
  },
  errorBanner: {
    background: 'rgba(220,30,30,0.12)', color: 'var(--red)',
    padding: '8px 12px', borderRadius: '4px', fontSize: '12px', marginBottom: '10px',
  },
  testOk: { color: 'var(--green)', fontSize: '11px', fontFamily: 'var(--font-mono)' },
  testFail: { color: 'var(--red)', fontSize: '11px', fontFamily: 'var(--font-mono)' },
  checkboxLabel: {
    display: 'flex', gap: '6px', alignItems: 'center',
    fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
  },
  modalBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  select: {
    width: '100%', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: '4px', padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '12px',
    color: 'var(--text-primary)', marginTop: '4px',
  },
  sourceBlock: {
    border: '1px solid var(--border)', borderRadius: '4px',
    padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px',
  },
  sourceHeader: {
    color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase',
    letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
  },
  sourceBody: { paddingLeft: '24px', display: 'flex', flexDirection: 'column' },
};
