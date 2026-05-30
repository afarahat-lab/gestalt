import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PageHeader, Card, EmptyState, LoadingSpinner } from '../components/shared/PageHeader';
import type { IntentSummary, ProjectSummary } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--amber)',
  normal:   'var(--text-dim)',
  low:      'var(--text-dim)',
};

const PROJECT_STORAGE_KEY = 'gestalt_project_id';

export function IntentFeed() {
  const api = useDashboardApi();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Persisted UUID of the currently-selected project. The previous
  // implementation read `gestalt_project` and defaulted to the string
  // `'default'`, which never matched a real project_id and caused
  // listIntents to return zero rows (the "failed intents had no trace
  // in the dashboard" bug). We now hydrate the project list from
  // /projects and pick either the persisted ID (if still valid) or the
  // first one.
  const [projectId, setProjectId] = useState<string | null>(() =>
    localStorage.getItem(PROJECT_STORAGE_KEY),
  );
  const [intents, setIntents] = useState<IntentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Hydrate projects on mount. Pick the persisted id if it still
  // resolves; otherwise fall back to the first project the API returns.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listProjects();
        if (cancelled) return;
        setProjects(res.data);
        const stillValid = projectId && res.data.some((p) => p.id === projectId);
        if (!stillValid && res.data[0]) {
          localStorage.setItem(PROJECT_STORAGE_KEY, res.data[0].id);
          setProjectId(res.data[0].id);
        }
      } catch { /* handled — load() will surface */ }
    })();
    return () => { cancelled = true; };
    // intentionally only on mount; project switches go through onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      // No status filter — the Intent Feed shows ALL intents for the
      // project, including failed and waiting-for-clarification.
      // Status visibility is the operator's primary signal that
      // something needs attention; filtering them out hid the failed
      // intents the operator reported missing.
      const res = await api.listIntents({ projectId, limit: 50 });
      setIntents(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch { /* handled */ } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);

  useLiveEvent('intent.created', () => { void load(); });
  useLiveEvent('intent.status-changed', () => { void load(); });

  const handleProjectChange = (id: string) => {
    localStorage.setItem(PROJECT_STORAGE_KEY, id);
    setProjectId(id);
  };

  const filtered = filter
    ? intents.filter(i =>
        i.status === filter ||
        i.text.toLowerCase().includes(filter.toLowerCase())
      )
    : intents;

  return (
    <div>
      <PageHeader
        title="Intents"
        subtitle={projectId
          ? `${total} total · ${projects.find((p) => p.id === projectId)?.name ?? projectId.slice(0, 8)}`
          : projects.length === 0 ? 'no project registered' : 'choose a project'}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {projects.length > 0 && (
              <select
                value={projectId ?? ''}
                onChange={(e) => handleProjectChange(e.target.value)}
                style={filterInputStyle}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <input
              placeholder="filter..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={filterInputStyle}
            />
          </div>
        }
      />

      <div style={{ padding: '20px 28px' }}>
        {loading ? (
          <LoadingSpinner />
        ) : !projectId ? (
          <EmptyState
            message="No projects registered"
            hint="Run `gestalt init` on the CLI to register your first project."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            message="No intents yet"
            hint="gestalt run &quot;describe what you want to build&quot;"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filtered.map(intent => (
              <Card
                key={intent.id}
                style={{ cursor: 'pointer', transition: 'border-color 0.12s' }}
              >
                <div
                  style={intentRowStyle}
                  onClick={() => navigate(`/intents/${intent.id}`)}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                >
                  {/* Priority stripe */}
                  <div style={{
                    width: '3px',
                    borderRadius: '2px',
                    background: PRIORITY_COLORS[intent.priority] ?? 'var(--border)',
                    alignSelf: 'stretch',
                    marginRight: '14px',
                    flexShrink: 0,
                  }} />

                  {/* Intent text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}
                       className="truncate">
                      {intent.text}
                    </p>
                    <p style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                      {intent.correlationId.slice(0, 8)}
                      {' · '}
                      {new Date(intent.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Status */}
                  <div style={{ flexShrink: 0, marginLeft: '16px' }}>
                    <StatusBadge status={intent.status} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const intentRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '14px 16px',
};

const filterInputStyle: React.CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: '5px',
  padding: '5px 10px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  outline: 'none',
  width: '180px',
};
