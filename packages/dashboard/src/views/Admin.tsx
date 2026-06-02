/**
 * Admin view — platform-admin only.
 *
 * Two tabs:
 *   - Users: list / create / role-toggle / deactivate, plus inline
 *     per-user project memberships
 *   - Projects: per-project member list with role change + add/remove
 *
 * Route guarded by `RequirePlatformAdmin` in App.tsx; the Admin nav
 * link in Layout is rendered only when `currentUser.role ===
 * 'platform-admin'`, so a regular user has no DOM trace of this view.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { useCurrentUser } from '../context/CurrentUserContext';
import { ApiError } from '../api/client';
import type {
  UserSummary, UserDetail, ProjectMember, ProjectSummary, UserRole, ProjectRole,
} from '../types';

type Tab = 'users' | 'projects';

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin</h1>
        <p style={styles.subtitle}>Platform users and project memberships</p>
      </div>
      <div style={styles.tabs}>
        <button
          style={tab === 'users' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
          onClick={() => setTab('users')}
        >Users</button>
        <button
          style={tab === 'projects' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
          onClick={() => setTab('projects')}
        >Projects</button>
      </div>
      {tab === 'users' ? <UsersTab /> : <ProjectsTab />}
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<Record<string, ProjectMember[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.data)).catch(() => {});
  }, [api]);

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

  return (
    <div>
      {error && (
        <div style={styles.errorStrip}>✗ {error}<button style={styles.muteBtn} onClick={() => setError(null)}>dismiss</button></div>
      )}
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>Project</th>
              <th style={styles.th}>Git URL</th>
              <th style={styles.th}>Members</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={4} style={styles.empty}>No projects yet — run gestalt init</td></tr>
            )}
            {projects.map((p) => (
              <React.Fragment key={p.id}>
                <tr style={styles.row} onClick={() => expand(p.id)}>
                  <td style={styles.td}>{expanded === p.id ? '▼' : '▶'}</td>
                  <td style={styles.td}>{p.name}</td>
                  <td style={styles.td}><span style={styles.mono}>{p.gitUrl}</span></td>
                  <td style={styles.td}>{members[p.id]?.length ?? '—'}</td>
                </tr>
                {expanded === p.id && (
                  <tr>
                    <td colSpan={4} style={styles.expanded}>
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

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '28px 32px', maxWidth: '1100px' },
  header: { marginBottom: '20px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' },
  subtitle: { margin: '4px 0 0 0', color: 'var(--text-dim)', fontSize: '13px' },
  tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', marginBottom: '16px' },
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
};
