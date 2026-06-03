/**
 * ProjectSettings — six-tab admin surface for per-project configuration.
 *
 *   /app/projects/:id/settings/(members|agents|custom-agents|pipeline|llms)
 *
 * Session 3: the standalone Tools tab is gone — tool assignment is
 * now part of the Agents tab (one Save call commits everything for
 * an agent). The model field in the Agents tab is a dropdown sourced
 * from the platform LLM registry (`/platform/llms`) plus a "Custom
 * model string..." escape hatch.
 *
 * Every config write goes through the new `/projects/:id/config/*`
 * endpoints which clone the project repo, edit the relevant file,
 * commit, and push. Members live on `/projects/:id/members` (the
 * existing routes, now tightened to project-admin) and DO NOT touch
 * Git.
 *
 * Authorization: route is guarded by `RequireProjectAdmin`. The
 * sidebar link is also conditional on the same role, so a reader can
 * never see this view in the DOM at all.
 *
 * Single fetch on first render: `GET /projects/:id/config` returns
 * `{ harness, agents }`; members are fetched separately and only by
 * the Members tab to keep the initial load small.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, NavLink, useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';
import { useCurrentUser } from '../context/CurrentUserContext';
import { useProject } from '../context/ProjectContext';
import { PageHeader, Card, EmptyState, LoadingSpinner } from '../components/shared/PageHeader';
import type {
  ProjectConfigResponse, EditableAgentConfig, ProjectConfigCustomAgent,
  ProjectMember, UserSummary, ProjectRole, PlatformLLM,
} from '../types';
import { ApiError } from '../api/client';

const BUILTIN_TOOLS = ['readFile', 'listDirectory', 'searchFiles', 'getFileTree'] as const;
type BuiltinTool = typeof BUILTIN_TOOLS[number];

const TABS = [
  { id: 'members',       label: 'Members' },
  { id: 'agents',        label: 'Agents' },
  { id: 'custom-agents', label: 'Custom agents' },
  { id: 'pipeline',      label: 'Pipeline' },
  { id: 'llms',          label: 'LLMs' },
] as const;
type TabId = typeof TABS[number]['id'];

// Read-only — surfaced in the brief's Agents-tab note.
const INFRASTRUCTURE_AGENTS = [
  'constraint-agent', 'lint-agent', 'security-agent', 'test-runner-agent',
  'pr-agent', 'pipeline-agent', 'promotion-agent',
  'gc-agent', 'evaluation-agent',
];

export function ProjectSettings() {
  const { id: projectId } = useParams<{ id: string }>();
  const api = useDashboardApi();
  const { user } = useCurrentUser();
  const { projects, currentUserRole } = useProject();
  const project = projects.find((p) => p.id === projectId);

  const [config, setConfig] = useState<ProjectConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('members');

  const isAuthorised = useMemo(() => {
    if (!user) return false;
    if (user.role === 'platform-admin') return true;
    return currentUserRole === 'project-admin';
  }, [user, currentUserRole]);

  const loadConfig = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProjectConfig(projectId);
      setConfig(res.data);
    } catch (err) {
      const msg = err instanceof ApiError ? extractErrorMessage(err) : (err instanceof Error ? err.message : String(err));
      setError(msg);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadConfig(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  if (!projectId || !project) {
    return (
      <div>
        <PageHeader title="Project settings" subtitle="project not found" />
        <div style={{ padding: '20px 28px' }}>
          <EmptyState message="No project selected" hint="Pick a project from the sidebar." />
        </div>
      </div>
    );
  }

  if (!isAuthorised) {
    return (
      <div>
        <PageHeader title="Project settings" subtitle={project.name} />
        <div style={{ padding: '20px 28px' }}>
          <EmptyState
            message="Project admin required"
            hint="Ask a platform-admin or project-admin to grant you the project-admin role."
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Project settings"
        subtitle={`${project.name} · config-as-code (HARNESS.json + agents.yaml)`}
      />
      <div style={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tabButton,
              ...(tab === t.id ? styles.tabButtonActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ padding: '14px 28px 28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {error && (
          <Card>
            <div style={{ padding: '14px', color: 'var(--red)' }}>
              ✗ {error}
            </div>
          </Card>
        )}
        {loading && <LoadingSpinner />}
        {!loading && config && (
          <>
            {tab === 'members'       && <MembersTab projectId={projectId} />}
            {tab === 'agents'        && <AgentsTab projectId={projectId} config={config} onSaved={loadConfig} />}
            {tab === 'custom-agents' && <CustomAgentsTab projectId={projectId} config={config} onSaved={loadConfig} />}
            {tab === 'pipeline'      && <PipelineTab projectId={projectId} config={config} onSaved={loadConfig} />}
            {tab === 'llms'          && <LlmsTab config={config} onJumpToAgents={() => setTab('agents')} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Members tab ─────────────────────────────────────────────────────────────

function MembersTab({ projectId }: { projectId: string }) {
  const api = useDashboardApi();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listMembers(projectId);
      setMembers(res.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function handleRoleChange(m: ProjectMember, role: ProjectRole) {
    setActionMsg(null); setActionError(null);
    try {
      await api.updateMemberRole(projectId, m.userId, role);
      setActionMsg(`Updated ${m.email} → ${role}`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
    }
  }

  async function handleRemove(m: ProjectMember) {
    if (!window.confirm(`Remove ${m.email} from this project?`)) return;
    setActionMsg(null); setActionError(null);
    try {
      await api.removeMember(projectId, m.userId);
      setActionMsg(`Removed ${m.email}`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <Card>
      <div style={styles.cardBody}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Members</h3>
          <button style={styles.primaryBtn} onClick={() => setShowAdd(true)}>+ Add member</button>
        </div>
        {actionMsg && <div style={styles.successBanner}>{actionMsg}</div>}
        {actionError && <div style={styles.errorBanner}>{actionError}</div>}
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td style={styles.td}>{m.email}</td>
                <td style={styles.td}>{m.displayName || <span style={{ color: 'var(--text-dim)' }}>(no name)</span>}</td>
                <td style={styles.td}>
                  <select
                    value={m.projectRole}
                    onChange={(e) => void handleRoleChange(m, e.target.value as ProjectRole)}
                    style={styles.select}
                  >
                    <option value="project-admin">★ Project admin</option>
                    <option value="editor">● Editor</option>
                    <option value="reader">○ Reader</option>
                  </select>
                </td>
                <td style={styles.td}>
                  <button style={styles.dangerBtn} onClick={() => void handleRemove(m)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>
            No members yet.
          </p>
        )}
        {showAdd && <AddMemberModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={() => { void load(); setShowAdd(false); }} />}
      </div>
    </Card>
  );
}

function AddMemberModal(props: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const api = useDashboardApi();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [picked, setPicked] = useState<UserSummary | null>(null);
  const [role, setRole] = useState<ProjectRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    api.listUsers({ search: search.trim() })
      .then((r) => { if (!cancelled) setResults(r.data); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [api, search]);

  async function handleAdd() {
    if (!picked) return;
    setError(null);
    try {
      await api.addMember(props.projectId, { userId: picked.id, role });
      props.onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>Add member</h3>
        <input
          autoFocus
          value={search}
          placeholder="Search users by email or name"
          onChange={(e) => setSearch(e.target.value)}
          style={styles.input}
        />
        {searching && <p style={{ color: 'var(--text-dim)' }}>Searching...</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0', maxHeight: '180px', overflow: 'auto' }}>
          {results.slice(0, 10).map((u) => (
            <li
              key={u.id}
              onClick={() => setPicked(u)}
              style={{
                padding: '8px',
                cursor: 'pointer',
                background: picked?.id === u.id ? 'var(--bg-subtle)' : 'transparent',
                borderRadius: '4px',
              }}
            >
              {u.email} {u.displayName && <span style={{ color: 'var(--text-dim)' }}>· {u.displayName}</span>}
            </li>
          ))}
        </ul>
        <label style={styles.label}>Role
          <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} style={styles.select}>
            <option value="project-admin">Project admin</option>
            <option value="editor">Editor</option>
            <option value="reader">Reader</option>
          </select>
        </label>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} disabled={!picked} onClick={handleAdd}>Add</button>
        </div>
      </div>
    </div>
  );
}

// ─── Agents tab ──────────────────────────────────────────────────────────────

interface AgentsTabProps {
  projectId: string;
  config: ProjectConfigResponse;
  onSaved: () => void;
}

function AgentsTab(props: AgentsTabProps) {
  const api = useDashboardApi();
  const [draft, setDraft] = useState<Record<string, EditableAgentConfig>>(() => deepCloneAgents(props.config.agents.agents ?? {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Platform LLM registry — populates the model dropdown for every
  // agent. Fetched once on mount; the dashboard refreshes when the
  // operator returns to the tab. `null` while loading so we can show
  // a placeholder option.
  const [llms, setLlms] = useState<PlatformLLM[] | null>(null);
  // Per-agent toggle: when true, the operator typed a model string
  // that isn't in the registry (the "Custom model string..." escape
  // hatch in the dropdown).
  const [customModelOpen, setCustomModelOpen] = useState<Record<string, boolean>>({});

  useEffect(() => { setDraft(deepCloneAgents(props.config.agents.agents ?? {})); }, [props.config]);
  useEffect(() => {
    let cancelled = false;
    api.listPlatformLlms()
      .then((r) => { if (!cancelled) setLlms(r.data); })
      .catch(() => { if (!cancelled) setLlms([]); });
    return () => { cancelled = true; };
  }, [api]);

  function updateAgent(role: string, partial: Partial<EditableAgentConfig>) {
    setDraft((prev) => ({ ...prev, [role]: { ...prev[role], ...partial } as EditableAgentConfig }));
  }
  function addExtension(role: string) {
    setDraft((prev) => {
      const cur = prev[role];
      const ext = [...(cur.promptExtensions ?? cur.prompt_extensions ?? []), ''];
      return { ...prev, [role]: { ...cur, promptExtensions: ext } };
    });
  }
  function updateExtension(role: string, i: number, value: string) {
    setDraft((prev) => {
      const cur = prev[role];
      const ext = [...(cur.promptExtensions ?? cur.prompt_extensions ?? [])];
      ext[i] = value;
      return { ...prev, [role]: { ...cur, promptExtensions: ext } };
    });
  }
  function removeExtension(role: string, i: number) {
    setDraft((prev) => {
      const cur = prev[role];
      const ext = [...(cur.promptExtensions ?? cur.prompt_extensions ?? [])];
      ext.splice(i, 1);
      return { ...prev, [role]: { ...cur, promptExtensions: ext } };
    });
  }

  // ── Tools handlers (Session 3 — merged from the ex-Tools tab) ──
  function toggleBuiltin(role: string, tool: BuiltinTool) {
    setDraft((prev) => {
      const cur = prev[role];
      const existing = cur.tools?.builtin ?? [];
      const next = existing.includes(tool)
        ? existing.filter((t) => t !== tool)
        : [...existing, tool];
      return {
        ...prev,
        [role]: { ...cur, tools: { ...(cur.tools ?? {}), builtin: next } },
      };
    });
  }
  function addMcp(role: string) {
    const name = window.prompt('MCP server name (e.g. github):');
    if (!name) return;
    const url = window.prompt('MCP server URL:');
    if (!url) return;
    const tokenFrom = window.prompt('Token source (project_credential | harness | env:VAR_NAME):', 'project_credential');
    if (!tokenFrom) return;
    setDraft((prev) => {
      const cur = prev[role];
      const mcp = [...(cur.tools?.mcp ?? []), { name, url, tokenFrom }];
      return { ...prev, [role]: { ...cur, tools: { ...(cur.tools ?? {}), mcp } } };
    });
  }
  function removeMcp(role: string, name: string) {
    setDraft((prev) => {
      const cur = prev[role];
      const mcp = (cur.tools?.mcp ?? []).filter((m) => m.name !== name);
      return { ...prev, [role]: { ...cur, tools: { ...(cur.tools ?? {}), mcp } } };
    });
  }

  async function handleSave() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      // Only send agents whose JSON differs from the current config.
      // The diff includes tools — one Save covers everything for an
      // agent (the Tools tab is gone; tool assignment is agent config).
      const patch: Record<string, Partial<EditableAgentConfig>> = {};
      const current = props.config.agents.agents ?? {};
      for (const [role, cfg] of Object.entries(draft)) {
        if (JSON.stringify(cfg) !== JSON.stringify(current[role])) {
          patch[role] = {
            role: cfg.role,
            goal: cfg.goal,
            llm: cfg.llm,
            promptExtensions: cfg.promptExtensions ?? cfg.prompt_extensions ?? [],
            ...(cfg.tools ? { tools: cfg.tools } : {}),
          };
        }
      }
      if (Object.keys(patch).length === 0) {
        setError('No changes to save');
        return;
      }
      await api.patchAgentsConfig(props.projectId, patch);
      setSuccess(`Saved ${Object.keys(patch).length} agent(s) — committed to repo`);
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <div style={styles.cardBody}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>Framework agents</h3>
            <button style={styles.primaryBtn} onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
          {success && <div style={styles.successBanner}>{success}</div>}
          {error && <div style={styles.errorBanner}>{error}</div>}
          {Object.keys(draft).length === 0 && (
            <p style={{ color: 'var(--text-dim)', padding: '20px 0' }}>
              No agents in agents.yaml yet. Defaults apply at runtime; save here to materialise them in the project repo.
            </p>
          )}
          {Object.entries(draft).map(([role, cfg]) => (
            <div key={role} style={styles.agentBlock}>
              <h4 style={styles.agentTitle}>{role}</h4>
              <FieldRow label="Role">
                <input style={styles.input} value={cfg.role}
                  onChange={(e) => updateAgent(role, { role: e.target.value })} />
              </FieldRow>
              <FieldRow label="Goal">
                <input style={styles.input} value={cfg.goal}
                  onChange={(e) => updateAgent(role, { goal: e.target.value })} />
              </FieldRow>
              <FieldRow label="Model">
                <ModelDropdown
                  llms={llms}
                  value={cfg.llm.model ?? null}
                  customOpen={!!customModelOpen[role]}
                  onChange={(value, asCustom) => {
                    updateAgent(role, { llm: { ...cfg.llm, model: value ?? undefined } });
                    setCustomModelOpen((prev) => ({ ...prev, [role]: asCustom }));
                  }}
                />
              </FieldRow>
              <div style={{ display: 'flex', gap: '12px' }}>
                <FieldRow label="Temperature">
                  <input type="number" step="0.05" min="0" max="2"
                    style={styles.input}
                    value={cfg.llm.temperature ?? ''}
                    onChange={(e) => updateAgent(role, { llm: { ...cfg.llm, temperature: e.target.value === '' ? undefined : parseFloat(e.target.value) } })} />
                </FieldRow>
                <FieldRow label="Max tokens">
                  <input type="number" step="100" min="1"
                    style={styles.input}
                    value={cfg.llm.maxTokens ?? cfg.llm.max_tokens ?? ''}
                    onChange={(e) => updateAgent(role, { llm: { ...cfg.llm, maxTokens: e.target.value === '' ? undefined : parseInt(e.target.value, 10) } })} />
                </FieldRow>
              </div>
              <div style={{ marginTop: '10px' }}>
                <label style={styles.label}>Prompt extensions</label>
                <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0' }}>
                  {(cfg.promptExtensions ?? cfg.prompt_extensions ?? []).map((ext, i) => (
                    <li key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                      <input style={{ ...styles.input, flex: 1 }} value={ext}
                        onChange={(e) => updateExtension(role, i, e.target.value)} />
                      <button style={styles.iconBtn} onClick={() => removeExtension(role, i)}>×</button>
                    </li>
                  ))}
                </ul>
                <button style={styles.linkBtn} onClick={() => addExtension(role)}>+ Add extension</button>
              </div>

              {/* Tools section — moved here from the ex-Tools tab
                  (Session 3). Tool assignment IS agent config; one
                  Save commits everything for an agent. */}
              <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px dashed var(--border)' }}>
                <label style={styles.label}>Tools</label>
                <div style={{ marginTop: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginRight: '8px' }}>Built-in:</span>
                  {BUILTIN_TOOLS.map((tool) => (
                    <label key={tool} style={{ ...styles.checkboxLabel, display: 'inline-flex', marginRight: '12px' }}>
                      <input type="checkbox"
                        checked={(cfg.tools?.builtin ?? []).includes(tool)}
                        onChange={() => toggleBuiltin(role, tool)} />
                      {tool}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>MCP servers:</span>
                    <button style={styles.linkBtn} onClick={() => addMcp(role)}>+ Add MCP server</button>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>
                    {(cfg.tools?.mcp ?? []).map((m) => (
                      <li key={m.name} style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 0', fontSize: '12px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                        <span style={{ color: 'var(--text-dim)' }}>{m.url}</span>
                        <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>({m.tokenFrom ?? m.token_from})</span>
                        <button style={styles.iconBtn} onClick={() => removeMcp(role, m.name)}>×</button>
                      </li>
                    ))}
                    {(cfg.tools?.mcp ?? []).length === 0 && (
                      <li style={{ color: 'var(--text-dim)', fontSize: '11px' }}>(no MCP servers)</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div style={styles.cardBody}>
          <h3 style={styles.cardTitle}>Infrastructure agents</h3>
          <p style={{ color: 'var(--text-dim)' }}>
            Infrastructure agents cannot be configured — they run deterministic checks
            (regex / cron / metric queries) and don't call the LLM.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {INFRASTRUCTURE_AGENTS.map((a) => (
              <li key={a} style={{ color: 'var(--text-dim)', padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                · {a}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}

// ─── Custom agents tab ───────────────────────────────────────────────────────

function CustomAgentsTab(props: AgentsTabProps) {
  const api = useDashboardApi();
  const initial = props.config.agents.custom_agents ?? props.config.agents.customAgents ?? [];
  const [list, setList] = useState<ProjectConfigCustomAgent[]>(initial);
  const [editing, setEditing] = useState<ProjectConfigCustomAgent | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setList(props.config.agents.custom_agents ?? props.config.agents.customAgents ?? []);
  }, [props.config]);

  async function commit(next: ProjectConfigCustomAgent[]) {
    setSaving(true); setError(null); setSuccess(null);
    try {
      await api.patchCustomAgentsConfig(props.projectId, next);
      setList(next);
      setSuccess('Custom agents saved — committed to repo');
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(name: string) {
    if (!window.confirm(`Remove custom agent '${name}'?`)) return;
    await commit(list.filter((d) => d.name !== name)).catch(() => undefined);
  }

  async function handleSaveModal(def: ProjectConfigCustomAgent) {
    const exists = list.some((d) => d.name === def.name);
    const next = exists
      ? list.map((d) => d.name === def.name ? def : d)
      : [...list, def];
    await commit(next);
    setEditing(null); setAdding(false);
  }

  return (
    <Card>
      <div style={styles.cardBody}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Custom agents</h3>
          <button style={styles.primaryBtn} onClick={() => { setAdding(true); setEditing(null); }} disabled={saving}>
            + Add custom agent
          </button>
        </div>
        {success && <div style={styles.successBanner}>{success}</div>}
        {error && <div style={styles.errorBanner}>{error}</div>}
        {list.length === 0 && (
          <p style={{ color: 'var(--text-dim)', padding: '12px 0' }}>
            No custom agents declared yet.
          </p>
        )}
        {list.map((d) => (
          <div key={d.name} style={styles.agentBlock}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={styles.agentTitle}>{d.name}</h4>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={styles.linkBtn} onClick={() => { setEditing(d); setAdding(false); }}>Edit</button>
                <button style={styles.dangerBtn} onClick={() => void handleRemove(d.name)}>×</button>
              </div>
            </div>
            <Row label="Role" value={d.role} />
            <Row label="Goal" value={d.goal} />
            <Row label="Runs after" value={d.runsAfter ?? d.runs_after ?? 'test-agent'} />
            <Row label="Model" value={d.llm.model ?? '~ (platform default)'} />
          </div>
        ))}
        {(adding || editing) && (
          <CustomAgentModal
            existing={editing}
            allAgents={Object.keys(props.config.agents.agents ?? {})}
            customNames={list.map((d) => d.name)}
            onClose={() => { setAdding(false); setEditing(null); }}
            onSave={(def) => void handleSaveModal(def)}
          />
        )}
      </div>
    </Card>
  );
}

function CustomAgentModal(props: {
  existing: ProjectConfigCustomAgent | null;
  allAgents: string[];
  customNames: string[];
  onClose: () => void;
  onSave: (def: ProjectConfigCustomAgent) => void;
}) {
  const [name, setName] = useState(props.existing?.name ?? '');
  const [role, setRole] = useState(props.existing?.role ?? '');
  const [goal, setGoal] = useState(props.existing?.goal ?? '');
  const [runsAfter, setRunsAfter] = useState(props.existing?.runsAfter ?? props.existing?.runs_after ?? 'test-agent');
  const [model, setModel] = useState(props.existing?.llm.model ?? '');
  const [temperature, setTemperature] = useState(String(props.existing?.llm.temperature ?? 0.1));
  const [maxTokens, setMaxTokens] = useState(String(props.existing?.llm.maxTokens ?? props.existing?.llm.max_tokens ?? 4000));
  const [prompt, setPrompt] = useState(props.existing?.prompt ?? '');

  function handleSave() {
    if (!name.trim() || !role.trim() || !prompt.trim()) return;
    props.onSave({
      name: name.trim(),
      role: role.trim(),
      goal: goal.trim(),
      runsAfter: runsAfter.trim() || null,
      llm: {
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(temperature ? { temperature: parseFloat(temperature) } : {}),
        ...(maxTokens ? { maxTokens: parseInt(maxTokens, 10) } : {}),
      },
      prompt,
    });
  }

  // Build a unique runs-after option list — every framework agent +
  // every other custom agent (excluding self).
  const runsAfterOptions = Array.from(new Set([
    ...props.allAgents,
    'test-agent',          // brief's default
    ...props.customNames.filter((n) => n !== name),
  ]));

  return (
    <div style={styles.modalBackdrop} onClick={props.onClose}>
      <div style={{ ...styles.modal, maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.cardTitle}>{props.existing ? `Edit ${props.existing.name}` : 'Add custom agent'}</h3>
        <FieldRow label="Name (kebab-case, must end -agent)">
          <input style={styles.input} value={name} disabled={!!props.existing}
            onChange={(e) => setName(e.target.value)} placeholder="security-review-agent" />
        </FieldRow>
        <FieldRow label="Role">
          <input style={styles.input} value={role} onChange={(e) => setRole(e.target.value)}
            placeholder="Application security reviewer" />
        </FieldRow>
        <FieldRow label="Goal">
          <input style={styles.input} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </FieldRow>
        <FieldRow label="Runs after">
          <select style={styles.select} value={runsAfter}
            onChange={(e) => setRunsAfter(e.target.value)}>
            {runsAfterOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </FieldRow>
        <div style={{ display: 'flex', gap: '8px' }}>
          <FieldRow label="Model">
            <input style={styles.input} value={model} placeholder="~ (platform default)"
              onChange={(e) => setModel(e.target.value)} />
          </FieldRow>
          <FieldRow label="Temperature">
            <input type="number" step="0.05" min="0" max="2" style={styles.input}
              value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </FieldRow>
          <FieldRow label="Max tokens">
            <input type="number" step="100" min="1" style={styles.input}
              value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </FieldRow>
        </div>
        <FieldRow label="Prompt (use placeholders: {{role}} {{goal}} {{artifacts}} {{goldenPrinciples}})">
          <textarea
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            style={{ ...styles.input, minHeight: '180px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
          />
        </FieldRow>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={styles.linkBtn} onClick={props.onClose}>Cancel</button>
          <button style={styles.primaryBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}


// ─── Pipeline tab ────────────────────────────────────────────────────────────

function PipelineTab(props: AgentsTabProps) {
  const api = useDashboardApi();
  const pipeline = (props.config.harness['pipeline'] as Record<string, unknown> | undefined) ?? {};
  const [adapter, setAdapter] = useState<string>((pipeline['adapter'] as string) ?? 'noop');
  const [autoMerge, setAutoMerge] = useState<boolean>(pipeline['autoMerge'] === true);
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>((pipeline['mergeMethod'] as 'merge' | 'squash' | 'rebase') ?? 'squash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      await api.patchPipelineConfig(props.projectId, { adapter, autoMerge, mergeMethod });
      setSuccess('Pipeline config saved — committed to repo');
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? extractErrorMessage(err) : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div style={styles.cardBody}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Pipeline configuration</h3>
          <button style={styles.primaryBtn} onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
        {success && <div style={styles.successBanner}>{success}</div>}
        {error && <div style={styles.errorBanner}>{error}</div>}
        <FieldRow label="CI/CD adapter">
          <label style={styles.radioLabel}>
            <input type="radio" name="adapter" value="noop" checked={adapter === 'noop'} onChange={() => setAdapter('noop')} />
            noop (fallback — no real CI)
          </label>
          <label style={styles.radioLabel}>
            <input type="radio" name="adapter" value="github-actions" checked={adapter === 'github-actions'} onChange={() => setAdapter('github-actions')} />
            github-actions
          </label>
        </FieldRow>
        <FieldRow label="Auto-merge">
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} />
            Automatically merge PR after CI passes (after staging promotion)
          </label>
        </FieldRow>
        <FieldRow label="Merge method">
          <label style={styles.radioLabel}>
            <input type="radio" name="merge-method" value="merge" checked={mergeMethod === 'merge'} onChange={() => setMergeMethod('merge')} />
            merge
          </label>
          <label style={styles.radioLabel}>
            <input type="radio" name="merge-method" value="squash" checked={mergeMethod === 'squash'} onChange={() => setMergeMethod('squash')} />
            squash
          </label>
          <label style={styles.radioLabel}>
            <input type="radio" name="merge-method" value="rebase" checked={mergeMethod === 'rebase'} onChange={() => setMergeMethod('rebase')} />
            rebase
          </label>
        </FieldRow>
      </div>
    </Card>
  );
}

// ─── LLMs tab ────────────────────────────────────────────────────────────────

function LlmsTab(props: { config: ProjectConfigResponse; onJumpToAgents: () => void }) {
  const agents = props.config.agents.agents ?? {};
  return (
    <Card>
      <div style={styles.cardBody}>
        <h3 style={styles.cardTitle}>LLM assignments</h3>
        <p style={{ color: 'var(--text-dim)' }}>
          Read-only summary. Click any row to edit in the Agents tab.
        </p>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Agent</th>
              <th style={styles.th}>Model override</th>
              <th style={styles.th}>Temperature</th>
              <th style={styles.th}>Max tokens</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(agents).map(([name, cfg]) => (
              <tr key={name} onClick={props.onJumpToAgents} style={{ cursor: 'pointer' }}>
                <td style={styles.td}>{name}</td>
                <td style={styles.td}>
                  {cfg.llm.model ?? <span style={{ color: 'var(--text-dim)' }}>~ (platform default)</span>}
                </td>
                <td style={styles.td}>{cfg.llm.temperature ?? '-'}</td>
                <td style={styles.td}>{cfg.llm.maxTokens ?? cfg.llm.max_tokens ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Helpers + styles ────────────────────────────────────────────────────────

/**
 * Model selector — `<select>` sourced from the platform LLM registry
 * (Session 3). When the operator picks "Custom model string..." the
 * dropdown collapses and a free-text input appears so they can
 * supply an unregistered model name. Selecting "~ Platform default"
 * clears the override (the agent will use whatever LLM is registered
 * as default at run time).
 */
function ModelDropdown(props: {
  llms: PlatformLLM[] | null;
  value: string | null;
  customOpen: boolean;
  onChange: (value: string | null, asCustom: boolean) => void;
}) {
  const { llms, value, customOpen, onChange } = props;
  if (llms === null) {
    return <input style={styles.input} value={value ?? ''} placeholder="Loading LLMs..." readOnly />;
  }
  const knownModel = llms.find((l) => l.modelString === value);
  const defaultLabel = (() => {
    const d = llms.find((l) => l.isDefault);
    return d ? `~ Platform default (${d.modelString})` : '~ Platform default';
  })();

  if (customOpen || (value && !knownModel)) {
    // Custom-string mode: free-text input with a "Back to dropdown"
    // affordance.
    return (
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          style={{ ...styles.input, flex: 1 }}
          value={value ?? ''}
          placeholder="Custom model string (e.g. claude-3-5-sonnet-20241022)"
          onChange={(e) => onChange(e.target.value || null, true)}
        />
        <button
          style={styles.linkBtn}
          onClick={() => onChange(null, false)}
        >Back to list</button>
      </div>
    );
  }

  const selectValue = value ?? '__default__';
  return (
    <select
      style={styles.input}
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__default__') return onChange(null, false);
        if (v === '__custom__') return onChange('', true);
        onChange(v, false);
      }}
    >
      <option value="__default__">{defaultLabel}</option>
      {llms.map((l) => (
        <option key={l.id} value={l.modelString}>
          {l.name}{l.provider !== 'custom' ? ` (${l.provider})` : ''}
        </option>
      ))}
      <option value="__custom__">Custom model string…</option>
    </select>
  );
}

function FieldRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: '8px' }}>
      <label style={styles.label}>{props.label}</label>
      <div style={{ marginTop: '4px' }}>{props.children}</div>
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-dim)', minWidth: '90px' }}>{props.label}:</span>
      <span style={{ color: 'var(--text-primary)' }}>{props.value}</span>
    </div>
  );
}

function deepCloneAgents(map: Record<string, EditableAgentConfig>): Record<string, EditableAgentConfig> {
  const out: Record<string, EditableAgentConfig> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = {
      role: v.role,
      goal: v.goal,
      llm: { ...v.llm },
      promptExtensions: [...(v.promptExtensions ?? v.prompt_extensions ?? [])],
      ...(v.tools ? { tools: { builtin: [...(v.tools.builtin ?? [])], mcp: v.tools.mcp ? v.tools.mcp.map((m) => ({ ...m })) : undefined } } : {}),
    };
  }
  return out;
}

function extractErrorMessage(err: ApiError): string {
  try {
    const parsed = JSON.parse(err.message) as { error?: string; details?: string };
    return parsed.error ?? err.message;
  } catch {
    return err.message;
  }
}

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: '0 28px',
    borderBottom: '1px solid var(--border)',
  },
  tabButton: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-dim)',
    padding: '10px 14px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    borderBottom: '2px solid transparent',
  },
  tabButtonActive: {
    color: 'var(--text-primary)',
    borderBottom: '2px solid var(--accent)',
  },
  cardBody: {
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    margin: 0,
    fontSize: '14px',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
  },
  agentBlock: {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '12px',
    marginTop: '10px',
  },
  agentTitle: {
    margin: '0 0 6px 0',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--accent)',
  },
  label: {
    fontSize: '11px',
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: 'var(--font-mono)',
  },
  input: {
    width: '100%',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '6px 8px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
  },
  select: {
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '4px 6px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  primaryBtn: {
    background: 'var(--accent)',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 14px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  dangerBtn: {
    background: 'transparent',
    color: 'var(--red)',
    border: '1px solid var(--red)',
    borderRadius: '4px',
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    cursor: 'pointer',
  },
  linkBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: '4px',
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    cursor: 'pointer',
  },
  iconBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    borderRadius: '4px',
    width: '24px',
    cursor: 'pointer',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    color: 'var(--text-dim)',
    fontFamily: 'var(--font-mono)',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '8px',
    borderBottom: '1px solid var(--border)',
  },
  successBanner: {
    background: 'rgba(0,180,80,0.12)',
    color: 'var(--green)',
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  errorBanner: {
    background: 'rgba(220,30,30,0.12)',
    color: 'var(--red)',
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    background: 'var(--bg-raised)',
    borderRadius: '8px',
    padding: '20px',
    maxWidth: '500px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  checkboxLabel: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
  },
  radioLabel: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
    marginRight: '12px',
  },
};

// Unused imports kept for future-proofing — silences the warning.
export const _internalLinks = { NavLink, useNavigate };
