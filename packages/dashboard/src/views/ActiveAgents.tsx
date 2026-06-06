import { useState, useEffect } from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { PageHeader, Card, EmptyState } from '../components/shared/PageHeader';
import type { AgentExecutionSummary } from '../types';

/**
 * Active-agents view — every agent currently running across every project.
 *
 * Each card answers three questions the operator wants in one glance:
 *   1. Which cycle is this agent serving?       → intent text
 *   2. How far through the plan are we?         → step N of M progress bar
 *   3. How much LLM has the cycle burned?       → token total so far
 *
 * The enrichment comes from `GET /status/agents` which folds in
 * `intentText`, `cycleProgress`, and `tokensSoFar` per execution.
 * Auto-refreshes every 5 seconds (kept from the previous
 * implementation); live `agent.started` / `agent.completed` SSE events
 * also refresh.
 */

const INTENT_TRUNCATE = 55;
const ROLE_COLOR: Record<string, string> = {
  'intent-agent':     'var(--blue)',
  'design-agent':     'var(--purple)',
  'code-agent':       'var(--accent)',
  'test-agent':       'var(--amber)',
  'context-agent':    'var(--blue)',
  'review-agent':     'var(--amber)',
  'constraint-agent': 'var(--red)',
  'pipeline-agent':   'var(--blue)',
};

export function ActiveAgents() {
  const api = useDashboardApi();
  const [agents, setAgents] = useState<AgentExecutionSummary[]>([]);

  const load = async () => {
    try {
      const res = await api.getActiveAgents();
      setAgents(res.data ?? []);
    } catch { /* */ }
  };

  useEffect(() => { void load(); }, []);
  useLiveEvent('agent.started', () => void load());
  useLiveEvent('agent.completed', () => void load());

  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <PageHeader
        title="Active agents"
        subtitle={agents.length > 0 ? `${agents.length} running` : 'idle'}
      />
      <div style={{ padding: '20px 28px' }}>
        {agents.length === 0 ? (
          <EmptyState message="No agents running" hint="platform is idle" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentExecutionSummary }) {
  const elapsed = agent.startedAt
    ? Math.round((Date.now() - new Date(agent.startedAt).getTime()) / 1000)
    : null;
  const elapsedText = elapsed === null ? '—' : formatElapsed(elapsed);
  const color = ROLE_COLOR[agent.agentRole] ?? 'var(--text-secondary)';

  const truncatedIntent = agent.intentText
    ? truncate(agent.intentText, INTENT_TRUNCATE)
    : null;
  const cycleHasSteps = (agent.cycleProgress?.total ?? 0) > 0;

  return (
    <Card>
      <div style={cardOuter}>
        {/* Header row — role + elapsed (top-right) */}
        <div style={headerRow}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '16px',
            color, animation: 'pulse-dot 1.5s infinite',
          }}>◎</span>
          <span style={roleText}>{agent.agentRole}</span>
          <span style={elapsedStyle}>{elapsedText}</span>
        </div>

        {/* Intent text */}
        {truncatedIntent && (
          <p style={intentLine}>
            <span style={{ color: 'var(--text-dim)' }}>“</span>
            {truncatedIntent}
            <span style={{ color: 'var(--text-dim)' }}>”</span>
          </p>
        )}

        {/* Progress bar + token count */}
        {(cycleHasSteps || (agent.tokensSoFar ?? 0) > 0) && (
          <div style={progressRow}>
            {cycleHasSteps && (
              <>
                <ProgressBar
                  completed={agent.cycleProgress!.completed}
                  total={agent.cycleProgress!.total}
                />
                <span style={progressLabel}>
                  step {agent.cycleProgress!.completed} of {agent.cycleProgress!.total}
                </span>
              </>
            )}
            {(agent.tokensSoFar ?? 0) > 0 && (
              <span style={tokenLabel}>
                {(agent.tokensSoFar ?? 0).toLocaleString()} tokens
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  // Render `total` segments. The first `completed` are filled (green);
  // the rest are muted.
  const segments = Array.from({ length: total }, (_, i) => i < completed);
  return (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
      {segments.map((filled, i) => (
        <div
          key={i}
          style={{
            width: '14px',
            height: '6px',
            borderRadius: '2px',
            background: filled ? 'var(--green)' : 'var(--bg-subtle)',
            border: filled ? 'none' : '1px solid var(--border)',
          }}
        />
      ))}
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardOuter: React.CSSProperties = {
  padding: '14px 18px',
  display: 'flex', flexDirection: 'column', gap: '8px',
};
const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
};
const roleText: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '13px',
  color: 'var(--text-primary)',
};
const elapsedStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-mono)', fontSize: '12px',
  color: 'var(--text-dim)',
};
const intentLine: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '12px',
  color: 'var(--text-secondary)',
  paddingLeft: '28px',  // align with role text under the ◎
  margin: 0,
};
const progressRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  paddingLeft: '28px',
  flexWrap: 'wrap',
};
const progressLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--text-dim)',
};
const tokenLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--text-dim)',
  marginLeft: 'auto',
};
