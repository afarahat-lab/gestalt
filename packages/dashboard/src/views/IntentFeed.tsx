import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { useProject } from '../context/ProjectContext';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PageHeader, Card, EmptyState, LoadingSpinner } from '../components/shared/PageHeader';
import type { IntentSummary } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--amber)',
  normal:   'var(--text-dim)',
  low:      'var(--text-dim)',
};

// Brief 5 — closed unions matching the server's IntentListFilters
const STATUS_OPTIONS = [
  'generating', 'in-review', 'approved',
  'deploying', 'deployed', 'failed',
  'escalated', 'waiting-for-clarification',
];
const SOURCE_OPTIONS = [
  'human', 'maintenance-agent', 'self-healing',
  'auto-resolved', 'operator-resume', 'pipeline-feedback',
];

interface FilterState {
  status: string;
  source: string;
  search: string;
  from: string;
  to: string;
}

function readFiltersFromUrl(params: URLSearchParams): FilterState {
  return {
    status: params.get('status') ?? '',
    source: params.get('source') ?? '',
    search: params.get('search') ?? '',
    from:   params.get('from')   ?? '',
    to:     params.get('to')     ?? '',
  };
}

function writeFiltersToUrl(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  return params;
}

export function IntentFeed() {
  const api = useDashboardApi();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Project selection lives in ProjectContext (sidebar selector). Per-view
  // localStorage reads and dropdowns from earlier sessions are gone.
  const { currentProjectId, currentProject } = useProject();
  const [intents, setIntents] = useState<IntentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Brief 5 — filters live in the URL so links are shareable.
  const filters = useMemo(() => readFiltersFromUrl(searchParams), [searchParams]);
  // Local search state for debouncing — bound to the input but only
  // applied to the URL (and therefore the fetch) after 300ms.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  // Debounce search → URL update
  useEffect(() => {
    if (searchInput === filters.search) return;
    const handle = setTimeout(() => {
      setSearchParams(writeFiltersToUrl({ ...filters, search: searchInput }), { replace: true });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, filters, setSearchParams]);

  const load = useCallback(async () => {
    if (!currentProjectId) { setIntents([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.listIntents({
        projectId: currentProjectId,
        status: filters.status || undefined,
        source: filters.source || undefined,
        search: filters.search || undefined,
        from:   filters.from   || undefined,
        to:     filters.to     || undefined,
        limit: 50,
      });
      setIntents(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch { /* handled */ } finally {
      setLoading(false);
    }
  }, [api, currentProjectId, filters]);

  useEffect(() => { void load(); }, [load]);

  useLiveEvent('intent.created', () => { void load(); });
  useLiveEvent('intent.status-changed', () => { void load(); });

  function updateFilter(patch: Partial<FilterState>) {
    setSearchParams(writeFiltersToUrl({ ...filters, ...patch }), { replace: true });
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const anyFilterActive =
    filters.status || filters.source || filters.search || filters.from || filters.to;

  return (
    <div>
      <PageHeader
        title="Intents"
        subtitle={currentProject
          ? `${total} total · ${currentProject.name}`
          : 'no project selected'}
      />

      {/* Brief 5 — filter bar above the list. Filters persist in the URL
          so /app/intents?status=failed&search=pnpm loads the filtered
          view in a new tab. */}
      <div style={filterBarStyle}>
        <select
          style={selectStyle}
          value={filters.status}
          onChange={(e) => updateFilter({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          style={selectStyle}
          value={filters.source}
          onChange={(e) => updateFilter({ source: e.target.value })}
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          placeholder="Search..."
          style={inputStyle}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <label style={dateLabelStyle}>
          From:
          <input
            type="date"
            style={dateInputStyle}
            value={filters.from}
            onChange={(e) => updateFilter({ from: e.target.value })}
          />
        </label>
        <label style={dateLabelStyle}>
          To:
          <input
            type="date"
            style={dateInputStyle}
            value={filters.to}
            onChange={(e) => updateFilter({ to: e.target.value })}
          />
        </label>
        {anyFilterActive && (
          <button style={clearBtnStyle} onClick={clearFilters} title="Clear all filters">
            × Clear
          </button>
        )}
      </div>

      <div style={{ padding: '20px 28px' }}>
        {loading ? (
          <LoadingSpinner />
        ) : !currentProjectId ? (
          <EmptyState
            message="No projects yet"
            hint={'Run `gestalt init` on the CLI to set up your first project.'}
          />
        ) : intents.length === 0 ? (
          <EmptyState
            message={anyFilterActive ? 'No intents match the current filters' : 'No intents yet'}
            hint={anyFilterActive ? 'Try clearing one or more filters.' : 'gestalt run "describe what you want to build"'}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {intents.map(intent => (
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

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 28px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  width: '180px',
};

const dateLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  color: 'var(--text-dim)',
};

const dateInputStyle: React.CSSProperties = {
  ...selectStyle,
  fontSize: '11px',
};

const clearBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '11px',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  marginLeft: 'auto',
};
