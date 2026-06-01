import React, { useState, useEffect, useCallback } from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { useLiveEvent } from '../hooks/useLiveEvents';
import { useProject } from '../context/ProjectContext';
import { PageHeader, Card, EmptyState, LoadingSpinner, Button } from '../components/shared/PageHeader';
import type { Alert } from '../types';

/**
 * Operator-facing alert feed.
 *
 * Each alert type renders a distinct card layout — the operator should
 * not have to guess what the alert is about or what they can do. Three
 * type-specific layouts today:
 *
 *   ? clarification-needed     — intent text + suggestions + textarea
 *     Two actions: "Resume intent" (existing /clarify flow) or
 *     "Submit fix intent" (queues a fresh intent with the alert's
 *     description as context).
 *
 *   ⚙ maintenance-stuck        — finding type + attempt count +
 *     affected files + suggestedAction + evidence. Single action:
 *     "Submit fix intent". `[Dismiss]` to acknowledge without action.
 *
 *   ⛔ GOLDEN_PRINCIPLE_BREACH — breachMessage + file:line + agent.
 *     Three actions: "Submit fix intent", "Resume without fix"
 *     (legacy intervention path), "Abort intent".
 *
 * Every alert also exposes "Dismiss" — acknowledge with optional notes
 * but no fix action.
 */

const FIX_TYPES: ReadonlyArray<string> = [
  'clarification-needed', 'maintenance-stuck', 'GOLDEN_PRINCIPLE_BREACH', 'gate-failed-max-retries',
];

export function Alerts() {
  const api = useDashboardApi();
  const { currentProjectId } = useProject();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // Alerts API has no projectId filter today — we filter client-side by
  // joining each alert's context.intentId against the project's intent
  // list. Pending enhancement: server-side projectId query param.
  const [projectIntentIds, setProjectIntentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-alert UI state — textarea + submitting flag keyed by alert.id
  // so opening two cards at once doesn't share input.
  const [clarification, setClarification] = useState<Record<string, string>>({});
  const [additionalContext, setAdditionalContext] = useState<Record<string, string>>({});
  const [dismissNotes, setDismissNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, string | null>>({});
  const [confirmation, setConfirmation] = useState<Record<string, string>>({});
  // GP_BREACH-only: required notes for `acknowledge-breach`. Keyed by
  // alert id so opening multiple cards at once doesn't share input.
  const [breachNotes, setBreachNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!currentProjectId) {
      setAlerts([]);
      setProjectIntentIds(new Set());
      setLoading(false);
      return;
    }
    try {
      const [alertsRes, intentsRes] = await Promise.all([
        api.listAlerts({ acknowledged: false }),
        api.listIntents({ projectId: currentProjectId, limit: 200 }),
      ]);
      setAlerts(alertsRes.data ?? []);
      setProjectIntentIds(new Set((intentsRes.data ?? []).map((i) => i.id)));
    } catch { /* ignore — empty state covers it */ } finally { setLoading(false); }
  }, [api, currentProjectId]);

  useEffect(() => { void load(); }, [load]);
  useLiveEvent('alert.created', () => void load());
  useLiveEvent('alert.acknowledged', () => void load());
  useLiveEvent('intent.status-changed', () => void load());
  useLiveEvent('intent.created', () => void load());

  const browserAlert = window.alert;

  // ─── Action handlers ──────────────────────────────────────────────────────

  const handleResumeClarification = async (alert: Alert): Promise<void> => {
    const text = (clarification[alert.id] ?? '').trim();
    if (!text) {
      browserAlert('Please describe the clarification before resuming.');
      return;
    }
    const intentId = alert.intentId
      ?? (typeof alert.context['intentId'] === 'string' ? (alert.context['intentId'] as string) : null);
    if (!intentId) {
      browserAlert('This alert is missing the intent id — cannot resume from the dashboard.');
      return;
    }
    setSubmitting((s) => ({ ...s, [alert.id]: 'resume' }));
    try {
      await api.clarifyIntent(intentId, { clarification: text });
      setConfirmation((c) => ({ ...c, [alert.id]: 'Clarification submitted — resuming intent' }));
      setClarification((s) => ({ ...s, [alert.id]: '' }));
      setTimeout(() => {
        setConfirmation((c) => { const n = { ...c }; delete n[alert.id]; return n; });
        setExpanded(null);
        void load();
      }, 1200);
    } finally {
      setSubmitting((s) => ({ ...s, [alert.id]: null }));
    }
  };

  const handleFixIntent = async (alert: Alert): Promise<void> => {
    const ctx = (additionalContext[alert.id] ?? '').trim();
    setSubmitting((s) => ({ ...s, [alert.id]: 'fix' }));
    try {
      const res = await api.submitAlertFixIntent(alert.id, ctx);
      const shortText = res.data.intentText.length > 80
        ? res.data.intentText.slice(0, 77) + '...'
        : res.data.intentText;
      setConfirmation((c) => ({ ...c, [alert.id]: `✓ Fix intent submitted — "${shortText}"` }));
      setAdditionalContext((s) => ({ ...s, [alert.id]: '' }));
      setTimeout(() => {
        setConfirmation((c) => { const n = { ...c }; delete n[alert.id]; return n; });
        setExpanded(null);
        void load();
      }, 1800);
    } catch (err) {
      browserAlert(`Failed to submit fix intent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting((s) => ({ ...s, [alert.id]: null }));
    }
  };

  // ADR-021 — GP_BREACH alert interventions. Three of the four ADR
  // actions are exposed on the alert card; `request-clarification`
  // ships as a CLI affordance today (the dashboard rarely needs it
  // because the operator can just open a new clarification flow).
  const handleIntervention = async (
    alert: Alert,
    action: 'resume' | 'abort' | 'acknowledge-breach',
  ): Promise<void> => {
    const intentId = alert.intentId
      ?? (typeof alert.context['intentId'] === 'string' ? (alert.context['intentId'] as string) : null);
    if (!intentId) {
      browserAlert('This alert has no intent id — cannot intervene from the dashboard.');
      return;
    }
    let notes: string | undefined;
    if (action === 'acknowledge-breach') {
      notes = (breachNotes[alert.id] ?? '').trim();
      if (!notes) {
        browserAlert('Describe why this breach occurred before acknowledging.');
        return;
      }
    } else if (action === 'abort') {
      const ok = window.confirm('Abort this intent? This cannot be undone.');
      if (!ok) return;
    }
    setSubmitting((s) => ({ ...s, [alert.id]: action }));
    try {
      const res = await api.submitIntervention({ intentId, action, notes });
      const message =
        action === 'resume'                ? '✓ Intent resumed — deploy chain started' :
        action === 'abort'                 ? '✓ Intent aborted' :
        /* acknowledge-breach */             '✓ Breach acknowledged';
      setConfirmation((c) => ({ ...c, [alert.id]: message }));
      setBreachNotes((s) => ({ ...s, [alert.id]: '' }));
      setTimeout(() => {
        setConfirmation((c) => { const n = { ...c }; delete n[alert.id]; return n; });
        setExpanded(null);
        void load();
      }, 1500);
      void res;
    } catch (err) {
      browserAlert(`Intervention failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting((s) => ({ ...s, [alert.id]: null }));
    }
  };

  const handleDismiss = async (alert: Alert): Promise<void> => {
    const notes = (dismissNotes[alert.id] ?? '').trim();
    setSubmitting((s) => ({ ...s, [alert.id]: 'dismiss' }));
    try {
      await api.dismissAlert(alert.id, notes);
      setConfirmation((c) => ({ ...c, [alert.id]: '✓ Alert dismissed' }));
      setDismissNotes((s) => ({ ...s, [alert.id]: '' }));
      setTimeout(() => {
        setConfirmation((c) => { const n = { ...c }; delete n[alert.id]; return n; });
        setExpanded(null);
        void load();
      }, 1000);
    } finally {
      setSubmitting((s) => ({ ...s, [alert.id]: null }));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;
  if (!currentProjectId) {
    return (
      <div>
        <PageHeader title="Alerts" subtitle="no project selected" />
        <div style={{ padding: '20px 28px' }}>
          <EmptyState
            message="No projects yet"
            hint={'Run `gestalt init` on the CLI to register a project.'}
          />
        </div>
      </div>
    );
  }

  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  // Client-side project scoping — keep alerts whose context.intentId (or
  // top-level intentId) belongs to this project; alerts without an
  // intentId (project-level / global) pass through.
  const projectScoped = alerts.filter((a) => {
    const intentId = a.intentId
      ?? (typeof a.context?.['intentId'] === 'string' ? (a.context['intentId'] as string) : null);
    // maintenance-stuck carries projectId directly in context, so we
    // can filter on that without joining intents.
    if (a.type === 'maintenance-stuck' && typeof a.context?.['projectId'] === 'string') {
      return a.context['projectId'] === currentProjectId;
    }
    if (!intentId) return true;
    return projectIntentIds.has(intentId);
  });
  const sorted = [...projectScoped].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle={sorted.length === 0 ? 'platform running autonomously' : `${sorted.length} requiring attention`}
      />
      <div style={{ padding: '20px 28px' }}>
        {sorted.length === 0 ? (
          <EmptyState
            message="No alerts — platform running autonomously"
            hint="This is the ideal state ✓"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sorted.map((alert) => {
              const isExpanded = expanded === alert.id;
              const canFix = FIX_TYPES.includes(alert.type);
              const confirmText = confirmation[alert.id];
              const busy = submitting[alert.id] !== null && submitting[alert.id] !== undefined;
              return (
                <Card
                  key={alert.id}
                  style={{
                    borderColor:
                      alert.type === 'GOLDEN_PRINCIPLE_BREACH' ? 'var(--red)' :
                      alert.type === 'clarification-needed' ? 'var(--amber)' :
                      alert.type === 'maintenance-stuck' ? 'var(--amber)' :
                      undefined,
                  }}
                >
                  <AlertHeader
                    alert={alert}
                    expanded={isExpanded}
                    onToggle={() => setExpanded(isExpanded ? null : alert.id)}
                  />
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--bg-base)' }}>
                      {confirmText && (
                        <div style={{
                          fontSize: '12px', color: 'var(--green)', fontFamily: 'var(--font-mono)',
                          marginBottom: '10px',
                        }}>{confirmText}</div>
                      )}
                      <AlertBody alert={alert} />
                      {alert.type === 'clarification-needed' && (
                        <ClarificationActions
                          alert={alert}
                          value={clarification[alert.id] ?? ''}
                          onChange={(v) => setClarification((s) => ({ ...s, [alert.id]: v }))}
                          onResume={() => void handleResumeClarification(alert)}
                          submittingMode={submitting[alert.id] ?? null}
                          busy={busy}
                        />
                      )}
                      {alert.type === 'GOLDEN_PRINCIPLE_BREACH' && (
                        <BreachInterventionBlock
                          alert={alert}
                          notes={breachNotes[alert.id] ?? ''}
                          onNotesChange={(v) => setBreachNotes((s) => ({ ...s, [alert.id]: v }))}
                          onResume={() => void handleIntervention(alert, 'resume')}
                          onAbort={() => void handleIntervention(alert, 'abort')}
                          onAcknowledge={() => void handleIntervention(alert, 'acknowledge-breach')}
                          submittingMode={submitting[alert.id] ?? null}
                          busy={busy}
                        />
                      )}
                      {canFix && (
                        <FixIntentBlock
                          alert={alert}
                          value={additionalContext[alert.id] ?? ''}
                          onChange={(v) => setAdditionalContext((s) => ({ ...s, [alert.id]: v }))}
                          onSubmit={() => void handleFixIntent(alert)}
                          submittingMode={submitting[alert.id] ?? null}
                          busy={busy}
                        />
                      )}
                      <DismissBlock
                        alert={alert}
                        value={dismissNotes[alert.id] ?? ''}
                        onChange={(v) => setDismissNotes((s) => ({ ...s, [alert.id]: v }))}
                        onSubmit={() => void handleDismiss(alert)}
                        submittingMode={submitting[alert.id] ?? null}
                        busy={busy}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Header (always visible) ──────────────────────────────────────────────────

function AlertHeader({ alert, expanded, onToggle }: {
  alert: Alert;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer' }}
      onClick={onToggle}
    >
      <TypeGlyph alert={alert} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '10px', textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-secondary)', flexShrink: 0,
      }}>
        {alert.type.replace(/_/g, ' ').replace(/-/g, ' ')}
      </span>
      <SeverityBadge severity={alert.severity} />
      <p style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{alert.title}</p>
      <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {new Date(alert.createdAt).toLocaleTimeString()}
      </span>
      <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{expanded ? '▲' : '▼'}</span>
    </div>
  );
}

function TypeGlyph({ alert }: { alert: Alert }) {
  const { glyph, color } =
    alert.type === 'clarification-needed'     ? { glyph: '?', color: 'var(--amber)' } :
    alert.type === 'maintenance-stuck'        ? { glyph: '⚙', color: 'var(--amber)' } :
    alert.type === 'GOLDEN_PRINCIPLE_BREACH'  ? { glyph: '⛔', color: 'var(--red)' } :
    alert.type === 'gate-failed-max-retries'  ? { glyph: '✗', color: 'var(--red)' } :
                                                { glyph: '!',  color: 'var(--text-dim)' };
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13px',
      color, width: '16px', flexShrink: 0, textAlign: 'center',
    }}>
      {glyph}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const bg =
    severity === 'critical' ? 'var(--red)' :
    severity === 'high'     ? 'var(--amber)' :
    severity === 'medium'   ? 'var(--blue)' :
                              'var(--text-dim)';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
      padding: '2px 6px', borderRadius: '3px',
      background: bg, color: severity === 'high' ? '#000' : '#fff',
      flexShrink: 0,
    }}>
      [{severity}]
    </span>
  );
}

// ─── Body — per-type detail ──────────────────────────────────────────────────

function AlertBody({ alert }: { alert: Alert }) {
  if (alert.type === 'clarification-needed') return <ClarificationBody alert={alert} />;
  if (alert.type === 'maintenance-stuck')    return <MaintenanceStuckBody alert={alert} />;
  if (alert.type === 'GOLDEN_PRINCIPLE_BREACH') return <BreachBody alert={alert} />;
  return (
    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
      {alert.description}
    </p>
  );
}

function ClarificationBody({ alert }: { alert: Alert }) {
  const suggestions = Array.isArray(alert.context?.['suggestions'])
    ? (alert.context['suggestions'] as string[])
    : [];
  return (
    <div style={{ marginBottom: '12px' }}>
      {alert.intentText && (
        <KV label="Intent">
          <span style={{ color: 'var(--text-primary)' }}>&quot;{alert.intentText}&quot;</span>
        </KV>
      )}
      {alert.intentStatus && <KV label="Status">{alert.intentStatus}</KV>}
      <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Why paused:</strong> {alert.description}
      </p>
      {suggestions.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <p style={mutedLabel}>Suggestions</p>
          <ul style={{ margin: '4px 0 0 18px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            {suggestions.map((s, i) => <li key={i} style={{ marginBottom: '3px' }}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function MaintenanceStuckBody({ alert }: { alert: Alert }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <KV label="Agent">{alert.context?.['agentRole'] as string ?? '(unknown)'}</KV>
      <KV label="Finding">{alert.findingType ?? '(unknown)'}</KV>
      {alert.attemptCount !== null && alert.attemptCount !== undefined && (
        <KV label="After">{alert.attemptCount} attempt{alert.attemptCount === 1 ? '' : 's'}</KV>
      )}
      {alert.suggestedAction && (
        <div style={{ marginTop: '10px' }}>
          <p style={mutedLabel}>What was tried</p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {alert.suggestedAction}
          </p>
        </div>
      )}
      {alert.affectedFiles && alert.affectedFiles.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <p style={mutedLabel}>Affected files</p>
          <ul style={{ margin: '4px 0 0 0', padding: 0, listStyle: 'none' }}>
            {alert.affectedFiles.map((f, i) => (
              <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {alert.evidence && (
        <div style={{ marginTop: '10px' }}>
          <p style={mutedLabel}>Evidence</p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {alert.evidence}
          </p>
        </div>
      )}
    </div>
  );
}

function BreachBody({ alert }: { alert: Alert }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      {alert.breachAgent && <KV label="Detected by">{alert.breachAgent}</KV>}
      <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>What happened:</strong>{' '}
        {alert.breachMessage ?? alert.description}
      </p>
      {alert.breachLocation && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <KV label="File">{alert.breachLocation.file}</KV>
          {alert.breachLocation.line !== undefined && (
            <KV label="Line">{alert.breachLocation.line}</KV>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Action blocks ────────────────────────────────────────────────────────────

/**
 * GP_BREACH-specific intervention block (ADR-021).
 *
 * Three of the four typed actions render here:
 *   - **Resume** — operator says "false positive, proceed". POST
 *     `/interventions` with `action: 'resume'` dispatches the deploy
 *     chain and transitions intent to `deploying`
 *   - **Abort** — operator says "real breach, give up". Confirm
 *     dialogue first, then POST with `action: 'abort'` → `failed`
 *   - **Acknowledge** — operator says "real breach, here's what
 *     happened". Notes are required (textarea; GP-006 — content
 *     persisted to interventions.notes; only length lands in audit)
 *
 * `request-clarification` is reachable via the CLI today; the
 * dashboard rarely needs it because the operator can submit a fresh
 * intent or open a new clarification flow inline.
 */
function BreachInterventionBlock(props: {
  alert: Alert;
  notes: string;
  onNotesChange: (v: string) => void;
  onResume: () => void;
  onAbort: () => void;
  onAcknowledge: () => void;
  submittingMode: string | null;
  busy: boolean;
}) {
  const { alert, notes, onNotesChange, onResume, onAbort, onAcknowledge, submittingMode, busy } = props;
  return (
    <ActionBlock title="Intervene (ADR-021)" alert={alert}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={onResume} disabled={busy}>
          {submittingMode === 'resume' ? 'resuming...' : '▶ Resume (false positive)'}
        </Button>
        <Button variant="danger" onClick={onAbort} disabled={busy}>
          {submittingMode === 'abort' ? 'aborting...' : '✗ Abort intent'}
        </Button>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '6px' }}>
        Or acknowledge with notes (transitions to failed, records why the breach happened):
      </div>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Required — describe why this breach occurred..."
        style={textareaStyle}
      />
      <div style={{ marginTop: '8px' }}>
        <Button onClick={onAcknowledge} disabled={busy || !notes.trim()}>
          {submittingMode === 'acknowledge-breach' ? 'acknowledging...' : '⚑ Acknowledge breach'}
        </Button>
      </div>
    </ActionBlock>
  );
}

function ClarificationActions({ alert, value, onChange, onResume, submittingMode, busy }: {
  alert: Alert; value: string;
  onChange: (v: string) => void;
  onResume: () => void;
  submittingMode: string | null;
  busy: boolean;
}) {
  return (
    <ActionBlock title="Provide clarification (resumes the existing intent)" alert={alert}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe the missing detail — success criteria, inputs, outputs, what 'done' looks like..."
        style={textareaStyle}
      />
      <div style={{ marginTop: '8px' }}>
        <Button
          variant="primary"
          onClick={onResume}
          disabled={busy || !value.trim()}
        >
          {submittingMode === 'resume' ? 'resuming...' : 'resume intent ▶'}
        </Button>
      </div>
    </ActionBlock>
  );
}

function FixIntentBlock({ alert, value, onChange, onSubmit, submittingMode, busy }: {
  alert: Alert; value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submittingMode: string | null;
  busy: boolean;
}) {
  const label =
    alert.type === 'clarification-needed' ? 'Or submit as a new intent (does not resume the existing one)' :
    'Submit a fix intent';
  return (
    <ActionBlock title={label} alert={alert}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add additional context (optional) — the alert's structural context is always included."
        style={textareaStyle}
      />
      <div style={{ marginTop: '8px' }}>
        <Button onClick={onSubmit} disabled={busy}>
          {submittingMode === 'fix' ? 'submitting...' : 'submit fix intent ▶'}
        </Button>
      </div>
    </ActionBlock>
  );
}

function DismissBlock({ alert, value, onChange, onSubmit, submittingMode, busy }: {
  alert: Alert; value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submittingMode: string | null;
  busy: boolean;
}) {
  return (
    <ActionBlock title="Dismiss (acknowledge without action)" alert={alert} compact>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional notes — reason for dismissal..."
        style={{ ...textareaStyle, minHeight: '50px' }}
      />
      <div style={{ marginTop: '8px' }}>
        <Button variant="danger" onClick={onSubmit} disabled={busy}>
          {submittingMode === 'dismiss' ? 'dismissing...' : 'dismiss'}
        </Button>
      </div>
    </ActionBlock>
  );
}

function ActionBlock({ title, children, compact }: {
  title: string;
  alert: Alert;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '5px',
      padding: compact ? '8px 10px' : '10px 12px', marginTop: '10px',
      background: 'var(--bg-subtle)',
    }}>
      <p style={mutedLabel}>{title}</p>
      <div style={{ marginTop: '6px' }}>{children}</div>
    </div>
  );
}

// ─── Helpers + styles ─────────────────────────────────────────────────────────

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '3px' }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: '90px',
      }}>{label}:</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
        {children}
      </span>
    </div>
  );
}

const mutedLabel: React.CSSProperties = {
  fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
  textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '70px',
  background: 'var(--bg-raised)',
  border: '1px solid var(--border)',
  borderRadius: '5px',
  padding: '8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'var(--font-mono)',
};
