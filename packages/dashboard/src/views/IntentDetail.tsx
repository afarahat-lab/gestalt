import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { StatusBadge, SignalBadge } from '../components/shared/StatusBadge';
import { PageHeader, Card, LoadingSpinner, Button } from '../components/shared/PageHeader';
import type { IntentDetail as IntentDetailType, AgentExecutionSummary, SignalSummary } from '../types';

interface ExecutionLogResponse {
  execution: AgentExecutionSummary;
  log: {
    prompt: string | null;
    llmResponse: string | null;
    resultStatus: string;
    artifactPaths: string[];
    signalTypes: string[];
    errorMessage: string | null;
  } | null;
  artifacts: Array<{ id: string; type: string; path: string; content: string }>;
  signals: SignalSummary[];
}

const PREVIEW_CHARS = 400;

export function IntentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = useDashboardApi();
  const [intent, setIntent] = useState<IntentDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [clarification, setClarification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Accordion state: set of expanded execution ids + cache of fetched logs +
  // per-execution "show full" toggles for prompt and response.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<Record<string, ExecutionLogResponse | 'loading' | 'error'>>({});
  const [showFull, setShowFull] = useState<Record<string, { prompt?: boolean; response?: boolean }>>({});

  const load = async () => {
    if (!id) return;
    try {
      const res = await api.getIntent(id);
      setIntent(res.data);
    } catch { /* */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [id]);
  useLiveEvent('agent.completed', () => void load());
  useLiveEvent('gate.completed', () => void load());
  useLiveEvent('intent.status-changed', () => void load());

  const handleClarify = async () => {
    if (!intent || !clarification.trim()) return;
    setSubmitting(true);
    try {
      await api.clarifyIntent(intent.id, { clarification, ambiguityId: 'amb-001' });
      setClarification('');
      await load();
    } finally { setSubmitting(false); }
  };

  const toggleExecution = async (execId: string) => {
    const next = new Set(expanded);
    if (next.has(execId)) {
      next.delete(execId);
      setExpanded(next);
      return;
    }
    next.add(execId);
    setExpanded(next);
    // Lazy-load on first open; reuse cache on subsequent toggles.
    if (logs[execId] === undefined) {
      setLogs((cur) => ({ ...cur, [execId]: 'loading' }));
      try {
        const res = await api.getExecutionLog(execId);
        setLogs((cur) => ({ ...cur, [execId]: res.data }));
      } catch {
        setLogs((cur) => ({ ...cur, [execId]: 'error' }));
      }
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied */ }
  };

  const toggleShowFull = (execId: string, field: 'prompt' | 'response') => {
    setShowFull((cur) => ({
      ...cur,
      [execId]: { ...cur[execId], [field]: !cur[execId]?.[field] },
    }));
  };

  if (loading) return <LoadingSpinner />;
  if (!intent) return <div style={{ padding: '28px', color: 'var(--text-dim)' }}>Intent not found</div>;

  const needsClarification = intent.status === 'waiting-for-clarification';

  return (
    <div>
      <PageHeader
        title="Intent detail"
        subtitle={intent.correlationId.slice(0, 8)}
        actions={
          <Button onClick={() => navigate(-1)}>← back</Button>
        }
      />

      <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Intent summary */}
        <Card>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '12px' }}>
              {intent.text}
            </p>
            <div style={metaRow}>
              <StatusBadge status={intent.status} />
              <span style={metaVal}>{intent.priority}</span>
              <span style={metaVal}>{new Date(intent.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </Card>

        {/* Clarification input */}
        {needsClarification && (
          <Card style={{ borderColor: 'var(--amber)' }}>
            <div style={{ padding: '16px' }}>
              <p style={{ fontSize: '12px', color: 'var(--amber)', fontFamily: 'var(--font-mono)',
                marginBottom: '10px' }}>
                ? Intent is ambiguous — your clarification is needed to continue
              </p>
              <textarea
                value={clarification}
                onChange={e => setClarification(e.target.value)}
                placeholder="Provide clarification..."
                style={textareaStyle}
              />
              <Button
                variant="primary"
                onClick={() => { void handleClarify(); }}
                disabled={submitting || !clarification.trim()}
              >
                resume cycle
              </Button>
            </div>
          </Card>
        )}

        {/* Agent timeline — each row is clickable; click expands an inline
            detail panel showing prompt + response + artifacts + signals. */}
        {intent.agentExecutions?.length > 0 && (
          <Card>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={sectionTitle}>Agent executions ({intent.agentExecutions.length})</p>
            </div>
            <div>
              {intent.agentExecutions.map((exec) => {
                const isExpanded = expanded.has(exec.id);
                const logState = logs[exec.id];
                return (
                  <div key={exec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* Header row — always visible */}
                    <div
                      style={{ ...execRow, cursor: 'pointer', borderBottom: 'none' }}
                      onClick={() => { void toggleExecution(exec.id); }}
                    >
                      <StatusBadge status={exec.status} size="sm" />
                      <span style={monoText}>{exec.agentRole}</span>
                      {exec.durationMs !== null && (
                        <span style={{ ...monoText, marginLeft: 'auto', color: 'var(--text-dim)' }}>
                          {exec.durationMs}ms
                        </span>
                      )}
                      <span style={{ color: 'var(--text-dim)', fontSize: '11px', marginLeft: '8px' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>

                    {/* Inline expanded panel */}
                    {isExpanded && (
                      <div style={panelOuter}>
                        {logState === 'loading' && (
                          <div style={panelMuted}>loading...</div>
                        )}
                        {logState === 'error' && (
                          <div style={{ ...panelError }}>
                            Failed to load execution log. The execution may have been cleaned up.
                          </div>
                        )}
                        {logState && logState !== 'loading' && logState !== 'error' && (
                          <ExecutionLogPanel
                            data={logState}
                            execId={exec.id}
                            showFull={showFull[exec.id] ?? {}}
                            onToggleFull={(field) => toggleShowFull(exec.id, field)}
                            onCopy={(text) => { void copyToClipboard(text); }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Aggregate signals + artifacts (cycle-wide, not per-execution) */}
        {intent.signals?.length > 0 && (
          <Card>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={sectionTitle}>Signals ({intent.signals.length})</p>
            </div>
            <div style={{ padding: '8px 0' }}>
              {intent.signals.map((sig) => (
                <div key={sig.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                    <SignalBadge type={sig.type} severity={sig.severity} />
                    <span style={{ ...monoText, color: 'var(--text-dim)' }}>{sig.sourceAgent}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sig.message}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {intent.artifacts?.length > 0 && (
          <Card>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={sectionTitle}>Artifacts ({intent.artifacts.length})</p>
            </div>
            <div style={{ padding: '8px 0' }}>
              {intent.artifacts.map((a) => (
                <div key={a.id} style={execRow}>
                  <span style={{ ...monoText, color: 'var(--text-dim)', fontSize: '10px',
                    background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: '3px' }}>
                    {a.type}
                  </span>
                  <span style={{ ...monoText, fontSize: '12px' }}>{a.path}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Inline execution log panel ──────────────────────────────────────────────

interface ExecutionLogPanelProps {
  data: ExecutionLogResponse;
  execId: string;
  showFull: { prompt?: boolean; response?: boolean };
  onToggleFull: (field: 'prompt' | 'response') => void;
  onCopy: (text: string) => void;
}

function ExecutionLogPanel({ data, showFull, onToggleFull, onCopy }: ExecutionLogPanelProps) {
  const { execution, log, artifacts, signals } = data;

  // Pre-migration-007 executions: no log row. Show a clear placeholder
  // instead of an empty panel (which would look like a UI bug).
  if (!log) {
    return (
      <div style={panelMuted}>
        Execution log not available for runs before this feature was introduced.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 16px' }}>

      {/* Error box — top of the panel when the agent failed */}
      {log.errorMessage && (
        <div style={errorBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>✗ error</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{log.errorMessage}</p>
        </div>
      )}

      {/* Agent meta */}
      <Section title="Agent">
        <KV label="Role">{execution.agentRole}</KV>
        <KV label="Status"><StatusBadge status={log.resultStatus} size="sm" /></KV>
        {execution.durationMs !== null && <KV label="Duration">{execution.durationMs}ms</KV>}
        {execution.startedAt && (
          <KV label="Started">{new Date(execution.startedAt).toLocaleTimeString()}</KV>
        )}
      </Section>

      {/* Prompt — null for non-LLM agents (lint-config / constraint /
          pr / pipeline / promotion) */}
      <Section
        title="Prompt"
        actions={
          log.prompt ? (
            <>
              <PanelButton onClick={() => onCopy(log.prompt!)}>copy</PanelButton>
              {log.prompt.length > PREVIEW_CHARS && (
                <PanelButton onClick={() => onToggleFull('prompt')}>
                  {showFull.prompt ? 'show less' : 'show full'}
                </PanelButton>
              )}
            </>
          ) : undefined
        }
      >
        {log.prompt === null ? (
          <span style={panelMutedInline}>— Not applicable (non-LLM agent)</span>
        ) : (
          <pre style={preStyle}>
            {showFull.prompt ? log.prompt : truncate(log.prompt)}
          </pre>
        )}
      </Section>

      {/* LLM response */}
      <Section
        title="LLM response"
        actions={
          log.llmResponse ? (
            <>
              <PanelButton onClick={() => onCopy(log.llmResponse!)}>copy</PanelButton>
              {log.llmResponse.length > PREVIEW_CHARS && (
                <PanelButton onClick={() => onToggleFull('response')}>
                  {showFull.response ? 'show less' : 'show full'}
                </PanelButton>
              )}
            </>
          ) : undefined
        }
      >
        {log.llmResponse === null ? (
          <span style={panelMutedInline}>— Not applicable</span>
        ) : (
          <pre style={preStyle}>
            {showFull.response ? log.llmResponse : truncate(log.llmResponse)}
          </pre>
        )}
      </Section>

      {/* Artifacts */}
      <Section title={`Artifacts produced (${artifacts.length})`}>
        {artifacts.length === 0 ? (
          <span style={panelMutedInline}>(none)</span>
        ) : (
          <ul style={listStyle}>
            {artifacts.map((a) => (
              <li key={a.id} style={listItem}>
                <span style={{ ...monoText, fontSize: '10px', color: 'var(--text-dim)',
                  background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: '3px', marginRight: '8px' }}>
                  {a.type}
                </span>
                <span style={{ ...monoText, fontSize: '12px' }}>{a.path}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Signals */}
      <Section title={`Signals emitted (${signals.length})`}>
        {signals.length === 0 ? (
          <span style={panelMutedInline}>(none)</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {signals.map((sig) => (
              <div key={sig.id}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
                  <SignalBadge type={sig.type} severity={sig.severity} />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sig.message}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, actions, children }: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={section}>
      <div style={sectionHeader}>
        <span style={sectionLabel}>{title}</span>
        {actions && <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>{actions}</div>}
      </div>
      <div style={sectionBody}>{children}</div>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '3px' }}>
      <span style={{ ...monoText, color: 'var(--text-dim)', width: '70px', fontSize: '11px' }}>{label}:</span>
      <span style={{ ...monoText, fontSize: '12px' }}>{children}</span>
    </div>
  );
}

function PanelButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg-subtle)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '2px 8px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function truncate(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text;
  return text.slice(0, PREVIEW_CHARS) + '... (' + (text.length - PREVIEW_CHARS) + ' more chars)';
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const metaRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
};
const metaVal: React.CSSProperties = {
  fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const execRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
};
const monoText: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)',
};
const textareaStyle: React.CSSProperties = {
  width: '100%', minHeight: '60px', marginBottom: '10px',
  background: 'var(--bg-base)', border: '1px solid var(--border-strong)',
  borderRadius: '5px', padding: '8px', fontSize: '12px',
  color: 'var(--text-primary)', outline: 'none', resize: 'vertical',
  fontFamily: 'var(--font-mono)',
};
const panelOuter: React.CSSProperties = {
  background: 'var(--bg-base)', borderTop: '1px solid var(--border)',
};
const panelMuted: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--text-dim)', padding: '14px 16px',
};
const panelMutedInline: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)',
};
const panelError: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--red)', padding: '14px 16px',
};
const section: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: '5px', overflow: 'hidden',
};
const sectionHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  padding: '8px 12px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
};
const sectionLabel: React.CSSProperties = {
  fontSize: '10px', fontFamily: 'var(--font-mono)',
  color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em',
};
const sectionBody: React.CSSProperties = {
  padding: '10px 12px',
};
const preStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--text-secondary)', margin: 0,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  maxHeight: '320px', overflowY: 'auto',
};
const listStyle: React.CSSProperties = {
  listStyle: 'none', padding: 0, margin: 0,
};
const listItem: React.CSSProperties = {
  padding: '4px 0',
};
const errorBox: React.CSSProperties = {
  border: '1px solid var(--red)', borderRadius: '5px',
  padding: '10px 12px', background: 'rgba(220, 38, 38, 0.08)',
};
