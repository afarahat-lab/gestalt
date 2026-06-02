import React, { useState, useEffect, useCallback } from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { useProject } from '../context/ProjectContext';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PageHeader, Card, EmptyState, LoadingSpinner } from '../components/shared/PageHeader';
import type { DeploymentSummary, DeploymentEvent, DeploymentEventType } from '../types';

/**
 * Deployments view — every intent that's reached the deploy layer for
 * the current project, rendered as a four-node pipeline timeline. A
 * fifth `Merged ✓` node is appended ONLY for cycles where auto-merge
 * fired (presence of an `auto-merged` deployment_events row); for
 * manual-merge projects the timeline stays at four nodes.
 *
 *   ●─PR────●─Pipeline──●─Staging────●─Production──[●─Merged]?
 *
 * Each node is filled when its corresponding `deployment_events` row
 * exists for the cycle. Pipeline-failed flips the Pipeline node red
 * and the downstream nodes stay muted. Pipeline-triggered (no
 * pipeline-passed yet) shows Pipeline as a pulsing in-progress node.
 */

const INTENT_TRUNCATE = 65;

/**
 * Which deployment_events row "fills" each base node. PR opens
 * → node 1. Pipeline finishes → node 2 (failed → red; running → in-progress).
 * promoted-staging → node 3. promoted-production → node 4.
 * `auto-merged` (node 5) is conditional — see `hasAutoMerge` below.
 */
const NODE_FILL_EVENT: Record<number, DeploymentEventType> = {
  0: 'pr-opened',
  1: 'pipeline-passed',
  2: 'promoted-staging',
  3: 'promoted-production',
  4: 'auto-merged',
};

/**
 * Whether to render the 5th `Merged ✓` node. We use event presence as
 * the canonical signal: the `auto-merged` row is written only when
 * `HARNESS.json` `pipeline.autoMerge === true` AND the merge call
 * succeeded. Manual-merge projects never produce one, so they stay at
 * 4 nodes — exactly the brief's contract.
 */
function hasAutoMerge(events: DeploymentEvent[]): boolean {
  return events.some((e) => e.eventType === 'auto-merged');
}

type NodeState = 'filled' | 'in-progress' | 'failed' | 'empty';

function classifyNode(
  index: number,
  events: DeploymentEvent[],
): { state: NodeState; event: DeploymentEvent | null } {
  // Pipeline (index 1) has the most failure modes — handle specially.
  if (index === 1) {
    const failed = events.find((e) => e.eventType === 'pipeline-failed');
    if (failed) return { state: 'failed', event: failed };
    const passed = events.find((e) => e.eventType === 'pipeline-passed');
    if (passed) return { state: 'filled', event: passed };
    const triggered = events.find((e) => e.eventType === 'pipeline-triggered');
    if (triggered) return { state: 'in-progress', event: triggered };
    return { state: 'empty', event: null };
  }
  const targetType = NODE_FILL_EVENT[index]!;
  const event = events.find((e) => e.eventType === targetType) ?? null;
  return { state: event ? 'filled' : 'empty', event };
}

export function Deployments() {
  const api = useDashboardApi();
  const { currentProjectId } = useProject();
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentProjectId) { setDeployments([]); setLoading(false); return; }
    try {
      const res = await api.listDeployments({ projectId: currentProjectId, limit: 20 });
      setDeployments(res.data ?? []);
    } catch { /* */ } finally { setLoading(false); }
  }, [api, currentProjectId]);

  useEffect(() => { void load(); }, [load]);
  useLiveEvent('deployment.updated', () => void load());
  useLiveEvent('intent.status-changed', () => void load());

  if (loading) return <LoadingSpinner />;
  if (!currentProjectId) {
    return (
      <div>
        <PageHeader title="Deployments" subtitle="no project selected" />
        <div style={{ padding: '20px 28px' }}>
          <EmptyState
            message="No projects yet"
            hint={'Run `gestalt init` on the CLI to register a project.'}
          />
        </div>
      </div>
    );
  }

  const inProgress = deployments.filter((d) => d.status === 'deploying');
  const completed = deployments.filter((d) => d.status === 'deployed');
  const failed = deployments.filter((d) => d.status === 'failed');

  return (
    <div>
      <PageHeader
        title="Deployments"
        subtitle={`${deployments.length} total · ${inProgress.length} in progress · ${completed.length} deployed`}
      />

      <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* In progress */}
        {inProgress.length > 0 && (
          <section>
            <p style={sectionLabel}>In progress</p>
            <div style={listColumn}>
              {inProgress.map((d) => <DeploymentRow key={d.intentId} deployment={d} />)}
            </div>
          </section>
        )}

        {/* Deployed history */}
        <section>
          <p style={sectionLabel}>Deployed ({completed.length})</p>
          {completed.length === 0 ? (
            <EmptyState message="No deployments yet" hint="Intents move here after deploying" />
          ) : (
            <div style={listColumn}>
              {completed.map((d) => <DeploymentRow key={d.intentId} deployment={d} />)}
            </div>
          )}
        </section>

        {/* Failed (small footer) */}
        {failed.length > 0 && (
          <section>
            <p style={sectionLabel}>Failed ({failed.length})</p>
            <div style={listColumn}>
              {failed.map((d) => <DeploymentRow key={d.intentId} deployment={d} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function DeploymentRow({ deployment }: { deployment: DeploymentSummary }) {
  const startedAt = new Date(deployment.startedAt);
  const completedAt = deployment.completedAt ? new Date(deployment.completedAt) : null;
  const headerDate = completedAt ?? startedAt;

  return (
    <Card>
      <div style={cardOuter}>
        {/* Top row — status badge, date, optional branch */}
        <div style={topRow}>
          <StatusBadge status={deployment.status} />
          {deployment.branch && (
            <span style={branchTag}>{deployment.branch}</span>
          )}
          <span style={topDate}>{formatDateTime(headerDate)}</span>
        </div>

        {/* Intent text — truncated */}
        <p style={intentLine}>{truncate(deployment.intentText, INTENT_TRUNCATE)}</p>

        {/* Pipeline timeline */}
        <PipelineTimeline deployment={deployment} />

        {/* Footer links */}
        <div style={footerRow}>
          {deployment.prUrl && (
            <ExternalLink href={deployment.prUrl}>
              ↗ View PR{deployment.prNumber ? ` #${deployment.prNumber}` : ''}
            </ExternalLink>
          )}
          {deployment.deploymentUrl && (
            <ExternalLink href={deployment.deploymentUrl}>
              ↗ View deployment
            </ExternalLink>
          )}
          {(() => {
            const merge = mergeCommitInfo(deployment);
            if (!merge) return null;
            const shortSha = merge.sha.slice(0, 7);
            return merge.url ? (
              <ExternalLink href={merge.url}>
                ↗ View commit {shortSha}
              </ExternalLink>
            ) : (
              <span style={{ ...extLink, cursor: 'default' }}>commit {shortSha}</span>
            );
          })()}
        </div>
      </div>
    </Card>
  );
}

const BASE_NODE_LABELS = ['PR', 'Pipeline', 'Staging', 'Production'];
const MERGED_NODE_LABEL = 'Merged';

function PipelineTimeline({ deployment }: { deployment: DeploymentSummary }) {
  const showMerged = hasAutoMerge(deployment.events);
  const labels = showMerged
    ? [...BASE_NODE_LABELS, MERGED_NODE_LABEL]
    : BASE_NODE_LABELS;
  const nodes = labels.map((label, i) => ({
    label,
    ...classifyNode(i, deployment.events),
  }));

  return (
    <div style={timelineOuter}>
      {nodes.map((node, i) => {
        const color = NODE_COLOR[node.state];
        const isLast = i === nodes.length - 1;
        const nextState = isLast ? null : nodes[i + 1]!.state;
        const connectorColor = node.state === 'filled' && nextState && nextState !== 'empty'
          ? 'var(--green)'
          : 'var(--border)';
        return (
          <React.Fragment key={i}>
            <div style={timelineNode}>
              <div style={{ ...nodeLabel, color }}>{node.label}</div>
              <div style={{ ...nodeDot, color, ...(node.state === 'in-progress' ? { animation: 'pulse-dot 1.5s infinite' } : {}) }}>
                {nodeGlyph(node.state)}
              </div>
              <div style={nodeStatus}>{statusLabel(node.state, node.label)}</div>
              <div style={nodeTime}>
                {node.event
                  ? new Date(node.event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </div>
            </div>
            {!isLast && (
              <div style={{
                flex: 1,
                height: '2px',
                background: connectorColor,
                marginTop: '38px',  // align with the dot row
                minWidth: '14px',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function nodeGlyph(state: NodeState): string {
  if (state === 'in-progress') return '◎';
  if (state === 'failed') return '✗';
  if (state === 'filled') return '●';
  return '○';
}

function statusLabel(state: NodeState, label: string): string {
  if (state === 'filled') {
    if (label === 'PR') return 'opened';
    if (label === 'Pipeline') return 'passed';
    if (label === 'Staging') return 'promoted';
    if (label === 'Merged') return 'merged ✓';
    return 'deployed';
  }
  if (state === 'in-progress') return 'running';
  if (state === 'failed') return 'failed';
  return 'pending';
}

/**
 * Pull the GitHub `<owner>/<repo>` from the cycle's `pr-opened` URL so
 * the dashboard can link to the merge commit. Returns null for projects
 * not hosted on github.com (the URL pattern wouldn't match) — the
 * commit link is suppressed in that case but the 5th node still
 * renders.
 */
function parseGitHubOwnerRepo(prUrl: string | null): { owner: string; repo: string } | null {
  if (!prUrl) return null;
  try {
    const u = new URL(prUrl);
    if (!u.hostname.endsWith('github.com')) return null;
    const parts = u.pathname.replace(/^\/+/, '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0]!, repo: parts[1]! };
  } catch {
    return null;
  }
}

function mergeCommitInfo(deployment: DeploymentSummary): { sha: string; url: string | null } | null {
  const event = deployment.events.find((e) => e.eventType === 'auto-merged');
  if (!event) return null;
  const sha = typeof event.metadata['sha'] === 'string' ? (event.metadata['sha'] as string) : null;
  if (!sha) return null;
  const repo = parseGitHubOwnerRepo(deployment.prUrl);
  const url = repo ? `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}` : null;
  return { sha, url };
}

const NODE_COLOR: Record<NodeState, string> = {
  'filled':      'var(--green)',
  'in-progress': 'var(--blue)',
  'failed':      'var(--red)',
  'empty':       'var(--text-dim)',
};

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={extLink}
    >
      {children}
    </a>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function formatDateTime(d: Date): string {
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
};
const listColumn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '10px',
};
const cardOuter: React.CSSProperties = {
  padding: '16px 18px',
  display: 'flex', flexDirection: 'column', gap: '14px',
};
const topRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
};
const branchTag: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '10px',
  color: 'var(--text-dim)', background: 'var(--bg-subtle)',
  padding: '2px 6px', borderRadius: '3px',
  border: '1px solid var(--border)',
};
const topDate: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)',
};
const intentLine: React.CSSProperties = {
  fontSize: '13px', color: 'var(--text-primary)', margin: 0,
};
const timelineOuter: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start',
  padding: '6px 4px 0',
};
const timelineNode: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  minWidth: '90px',
};
const nodeLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '10px',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  marginBottom: '6px',
};
const nodeDot: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '20px',
  marginBottom: '6px',
};
const nodeStatus: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--text-secondary)',
};
const nodeTime: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '10px',
  color: 'var(--text-dim)', marginTop: '2px',
};
const footerRow: React.CSSProperties = {
  display: 'flex', gap: '12px', flexWrap: 'wrap',
};
const extLink: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '11px',
  color: 'var(--accent)',
  textDecoration: 'none',
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  background: 'var(--bg-subtle)',
};
