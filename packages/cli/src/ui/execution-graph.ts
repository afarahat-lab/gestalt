/**
 * Shared execution-flow renderer for the CLI.
 *
 * Used by `gestalt intent show <id>` and by `gestalt status --id <id>
 * --graph`. Renders the full intent's execution timeline grouped by
 * layer (Generate / Quality gate / Deploy), followed by a signals
 * summary. Pure formatting — no I/O. The caller fetches the data via
 * the API client and passes it in.
 *
 * The 19 agent role names that count as "framework" come straight
 * from the dashboard's `IntentDetail.tsx` — same list, same purpose
 * (anything else is a custom agent and gets the `[custom]` tag).
 */

import type {
  IntentDetail, AgentExecution, SignalSummary,
  DeploymentEvent,
} from '../api/client';
import { c, statusBadge } from './prompts';

// ─── Agent role classification ───────────────────────────────────────────────

/**
 * Same set the dashboard uses to colour-code rows in
 * IntentDetail.tsx. Anything not in this set is a custom agent.
 */
export const FRAMEWORK_AGENTS: ReadonlySet<string> = new Set([
  'intent-agent', 'design-agent', 'context-agent', 'lint-config-agent',
  'code-agent', 'test-agent', 'review-agent', 'constraint-agent',
  'pr-agent', 'pipeline-agent', 'promotion-agent', 'drift-agent',
  'alignment-agent', 'gc-agent', 'evaluation-agent', 'context-fixer',
]);

const GENERATE_AGENTS = new Set([
  'intent-agent', 'design-agent', 'context-agent', 'lint-config-agent',
  'code-agent', 'test-agent',
]);

// ADR-041 — gate runs post-CI; lint / security / test-runner removed.
const GATE_AGENTS = new Set(['constraint-agent', 'review-agent']);

const DEPLOY_AGENTS = new Set([
  'pr-agent', 'pipeline-agent', 'promotion-agent',
]);

export function isGenerateAgent(role: string): boolean {
  // Customs (anything not in FRAMEWORK_AGENTS) belong to the generate
  // layer per ADR-037 — they run AFTER framework generate agents and
  // BEFORE the gate dispatch.
  return GENERATE_AGENTS.has(role) || !FRAMEWORK_AGENTS.has(role);
}
export function isGateAgent(role: string): boolean {
  return GATE_AGENTS.has(role);
}
export function isDeployAgent(role: string): boolean {
  return DEPLOY_AGENTS.has(role);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'completed': return c.success('✓');
    case 'failed':    return c.error('✗');
    case 'skipped':   return c.dim('–');
    case 'running':   return c.info('◎');
    case 'passed':    return c.success('✓');
    default:          return c.dim('?');
  }
}

function signalIcon(type: string): string {
  switch (type) {
    case 'GOLDEN_PRINCIPLE_BREACH': return c.error('⛔');
    case 'CONSTRAINT_VIOLATION':    return c.warn('⚠');
    case 'TEST_FAILURE':            return c.error('✗');
    case 'LINT_FAILURE':            return c.warn('⚠');
    case 'CONTEXT_GAP':             return c.info('?');
    default:                        return c.dim('•');
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number | undefined): string {
  if (!tokens) return '';
  return `${tokens.toLocaleString()} tokens`;
}

// ─── Per-row formatters ──────────────────────────────────────────────────────

function formatExecution(e: AgentExecution): string {
  const isCustom = !FRAMEWORK_AGENTS.has(e.agentRole);
  const customTag = isCustom ? ' ' + c.agent('[custom]') : '';
  const dur = formatDuration(e.durationMs);
  const tokens = formatTokens(e.tokensUsed);

  // Layout: glyph  role(padded)  duration  tokens  [custom]
  const role = c.agent(e.agentRole.padEnd(20));
  const stats = [dur, tokens].filter(Boolean).map((s) => c.dim(s)).join('  ');
  const sep = stats ? '  ' : '';
  return `  ${statusGlyph(e.status)} ${role}${sep}${stats}${customTag}`;
}

function formatDeployStep(
  e: AgentExecution,
  events: DeploymentEvent[],
): string {
  const base = formatExecution(e);
  let extra = '';
  if (e.agentRole === 'pr-agent') {
    const ev = events.find((d) => d.eventType === 'pr-opened');
    if (ev?.prNumber !== undefined && ev.prNumber !== null) {
      extra = `   ${c.dim('PR')} ${c.info(`#${ev.prNumber}`)}`;
    }
  } else if (e.agentRole === 'pipeline-agent') {
    const ev = events.find((d) => d.eventType === 'pipeline-passed')
            ?? events.find((d) => d.eventType === 'pipeline-triggered')
            ?? events.find((d) => d.eventType === 'pipeline-failed');
    if (ev?.runId) {
      extra = `   ${c.dim('run')} ${c.info(`#${ev.runId}`)}`;
    }
  } else if (e.agentRole === 'promotion-agent') {
    const staging = events.find((d) => d.eventType === 'promoted-staging');
    const production = events.find((d) => d.eventType === 'promoted-production');
    const merged = events.find((d) => d.eventType === 'auto-merged');
    const arrows: string[] = [];
    if (staging) arrows.push('staging');
    if (production) arrows.push('production');
    if (arrows.length) extra = `   ${c.dim(arrows.join(' → '))}`;
    if (merged) {
      const sha = typeof merged.metadata['sha'] === 'string'
        ? (merged.metadata['sha'] as string).slice(0, 7)
        : null;
      extra += sha ? `   ${c.success('✓ auto-merged ' + sha)}` : `   ${c.success('✓ auto-merged')}`;
    }
  }
  return base + extra;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function renderHeader(intent: IntentDetail): string[] {
  const headerWidth = 56;
  const lines: string[] = [];
  lines.push(c.dim('╔' + '═'.repeat(headerWidth) + '╗'));
  // The visible intent + status text uses ANSI, so we pad without
  // measuring the colour codes — just use space padding to the
  // box width minus the literal content lengths.
  const intentLine = `Intent: ${truncate(intent.text, headerWidth - 12)}`;
  lines.push(c.dim('║ ') + intentLine + ' '.repeat(Math.max(0, headerWidth - intentLine.length - 1)) + c.dim('║'));
  const statusLine = `Status: ${intent.status}`;
  const idLine = `ID: ${intent.correlationId.slice(0, 8)}`;
  const combined = `${statusLine.padEnd(28)}${idLine}`;
  lines.push(c.dim('║ ') + combined + ' '.repeat(Math.max(0, headerWidth - combined.length - 1)) + c.dim('║'));
  lines.push(c.dim('╚' + '═'.repeat(headerWidth) + '╝'));
  return lines;
}

// ─── Main render ─────────────────────────────────────────────────────────────

export interface ExecutionGraphInput {
  intent: IntentDetail;
  /**
   * Deployment events for the cycle. Optional — when absent the deploy
   * agent rows render without their PR / run / merge extras. Caller
   * fetches via `GET /deployments?correlationId=<corr>`.
   */
  deploymentEvents?: DeploymentEvent[];
}

export function renderExecutionGraph(input: ExecutionGraphInput): string {
  const { intent, deploymentEvents = [] } = input;
  const executions = intent.agentExecutions ?? [];
  const signals = intent.signals ?? [];

  const lines: string[] = [];

  // Header
  lines.push(...renderHeader(intent));
  // Re-print the typed status badge underneath for clarity.
  lines.push(`  ${statusBadge(intent.status)}`);
  lines.push('');

  // Group by layer
  const generate = executions.filter((e) => isGenerateAgent(e.agentRole));
  const gate     = executions.filter((e) => isGateAgent(e.agentRole));
  const deploy   = executions.filter((e) => isDeployAgent(e.agentRole));

  if (generate.length > 0) {
    lines.push(c.bold('Generate'));
    for (const e of generate) lines.push(formatExecution(e));
    lines.push('');
  }

  if (gate.length > 0) {
    lines.push(c.bold('Quality gate'));
    for (const e of gate) lines.push(formatExecution(e));
    lines.push('');
  }

  if (deploy.length > 0) {
    lines.push(c.bold('Deploy'));
    for (const e of deploy) lines.push(formatDeployStep(e, deploymentEvents));
    lines.push('');
  }

  // Signals summary
  const blocking = signals.filter((s) =>
    s.type === 'CONSTRAINT_VIOLATION' || s.type === 'GOLDEN_PRINCIPLE_BREACH',
  );
  const lint = signals.filter((s) => s.type === 'LINT_FAILURE');
  if (signals.length > 0 || blocking.length > 0 || lint.length > 0) {
    const blockLabel = c.warn(`${blocking.length} blocking`);
    const lintLabel = c.dim(`${lint.length} lint`);
    lines.push(c.bold(`Signals (${blockLabel}, ${lintLabel})`));
    const shown = [...blocking, ...lint].slice(0, 5);
    for (const s of shown) lines.push(formatSignal(s));
    if (signals.length > shown.length) {
      lines.push(c.dim(`  ... and ${signals.length - shown.length} more`));
    }
  } else {
    lines.push(c.dim('No signals'));
  }
  lines.push('');

  return lines.join('\n');
}

function formatSignal(s: SignalSummary): string {
  const icon = signalIcon(s.type);
  const type = c.signal(s.type, s.severity).padEnd(38);
  const source = c.dim(s.sourceAgent.padEnd(20));
  const message = truncate(s.message, 50);
  return `  ${icon} ${type} ${source} ${message}`;
}

// ─── Terminal-clearing helper for --watch ────────────────────────────────────

const CLEAR_SCREEN = '\x1b[2J\x1b[H';

/**
 * Returns true when the intent has reached a status that won't change
 * without operator action. `gestalt status --watch` and
 * `gestalt intent show --watch` poll until this returns true.
 */
export function isTerminalIntentStatus(status: string): boolean {
  return status === 'deployed' || status === 'failed' || status === 'escalated';
}

export function clearScreen(): void {
  process.stdout.write(CLEAR_SCREEN);
}
