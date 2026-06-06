/**
 * gestalt gate show <intentId>
 *   → GET /intents/:id  (already includes gate executions and signals)
 *
 * Prints the quality-gate layer detail for one intent cycle:
 *   - verdict (passed / failed / escalated) derived from intent status
 *   - per-gate-agent rows with status, duration, and a per-row summary
 *     (constraint violations / lint warnings / test pass-fail)
 *   - signals filtered to those produced by the gate
 *
 * Accepts an 8-char correlationId prefix OR a full UUID (same shape as
 * `gestalt intent show`).
 */

import {
  GestaltApiClient,
  type IntentDetail, type AgentExecution, type SignalSummary,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import { c, blank, divider } from '../ui/prompts';
import { isGateAgent } from '../ui/execution-graph';
import { resolveIntentId } from '../ui/intent-resolver';

export interface GateShowOptions {
  server?: string;
}

export async function gateShowCommand(
  id: string,
  options: GateShowOptions = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const intent = await fetchIntent(client, id, config.currentProjectId);
    renderGateDetail(intent);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderGateDetail(intent: IntentDetail): void {
  const gateExecs = (intent.agentExecutions ?? []).filter((e) => isGateAgent(e.agentRole));
  const allSignals = intent.signals ?? [];
  const gateSignals = allSignals.filter((s) =>
    GATE_SOURCE_AGENTS.has(s.sourceAgent) || isGateAgent(s.sourceAgent),
  );

  blank();
  console.log(c.bold(`Quality gate — intent ${intent.correlationId.slice(0, 8)}`));
  divider();

  // Verdict derived from intent status. The orchestrator's gate result
  // is the source of truth for the verdict; intent status reflects it
  // after the transition.
  const verdict = verdictFor(intent.status, gateSignals);
  console.log(`${c.dim('Verdict:'.padEnd(12))} ${verdict}`);

  // Gate retry count is not stored on the intent today — surface the
  // agent_executions row count for the review-agent as a proxy.
  const reviewRuns = gateExecs.filter((e) => e.agentRole === 'review-agent').length;
  if (reviewRuns > 1) {
    console.log(`${c.dim('Cycles:'.padEnd(12))} ${reviewRuns} gate runs`);
  }

  blank();
  console.log(c.bold('Checks'));
  if (gateExecs.length === 0) {
    console.log(c.dim('  No gate executions found for this intent.'));
  } else {
    for (const e of gateExecs) {
      console.log(formatCheck(e, allSignals));
    }
  }

  blank();
  const blocking = allSignals.filter((s) =>
    s.type === 'GOLDEN_PRINCIPLE_BREACH' || s.type === 'CONSTRAINT_VIOLATION',
  );
  console.log(
    c.bold(`Signals (${allSignals.length} total, ${blocking.length} blocking)`),
  );
  if (allSignals.length === 0) {
    console.log(c.dim('  No signals emitted.'));
  } else {
    for (const s of allSignals) {
      console.log(formatSignal(s));
    }
  }
  blank();
}

// ADR-041 — gate runs post-CI; constraint-agent + review-agent only.
const GATE_SOURCE_AGENTS = new Set(['constraint-agent', 'review-agent']);

function verdictFor(status: string, gateSignals: SignalSummary[]): string {
  if (status === 'escalated') return c.error('⚠ escalated');
  if (status === 'failed') return c.warn('✗ failed');
  if (status === 'approved' || status === 'deploying' || status === 'deployed') {
    return c.success('✓ passed');
  }
  if (status === 'in-review') {
    // Cycle is still inside the gate. If any GP_BREACH has landed
    // already, render the in-progress verdict; otherwise just "running".
    const hasBlocking = gateSignals.some(
      (s) => s.type === 'GOLDEN_PRINCIPLE_BREACH' || s.type === 'CONSTRAINT_VIOLATION',
    );
    return hasBlocking ? c.warn('◎ in review') : c.info('◎ in review');
  }
  return c.dim(status);
}

function formatCheck(e: AgentExecution, allSignals: SignalSummary[]): string {
  // Per-agent quick summary so the row is informative beyond
  // pass/fail. ADR-041 — gate runs constraint-agent + review-agent
  // only (lint / security / test-runner moved to CI).
  const own = allSignals.filter((s) => s.sourceAgent === e.agentRole);
  let summary = '';
  switch (e.agentRole) {
    case 'constraint-agent': {
      const count = own.length;
      summary = `${count} violation${count === 1 ? '' : 's'}`;
      break;
    }
    case 'review-agent': {
      const findings = own.length;
      summary = findings === 0 ? 'no concerns' : `${findings} finding${findings === 1 ? '' : 's'}`;
      break;
    }
  }
  const glyph =
    e.status === 'completed' || e.status === 'passed' ? c.success('✓') :
    e.status === 'failed' ? c.error('✗') :
    e.status === 'skipped' ? c.dim('–') :
    e.status === 'running' ? c.info('◎') : c.dim('?');
  const role = c.agent(e.agentRole.padEnd(20));
  const dur = e.durationMs ? c.dim(`${e.durationMs}ms`.padStart(8)) : c.dim('       –');
  return `  ${glyph} ${role}  ${dur}   ${c.dim(summary)}`;
}

function formatSignal(s: SignalSummary): string {
  const sev = s.severity;
  const label = c.signal(s.type, sev).padEnd(38);
  const source = c.dim(s.sourceAgent.padEnd(20));
  return `  ${signalGlyph(s.type)} ${label} ${source} ${s.message.slice(0, 70)}`;
}

function signalGlyph(type: string): string {
  if (type === 'GOLDEN_PRINCIPLE_BREACH') return c.error('⛔');
  if (type === 'CONSTRAINT_VIOLATION') return c.warn('⚠');
  if (type === 'TEST_FAILURE') return c.error('✗');
  if (type === 'LINT_FAILURE') return c.warn('⚠');
  if (type === 'CONTEXT_GAP') return c.info('?');
  return c.dim('•');
}

async function fetchIntent(
  client: GestaltApiClient,
  idOrPrefix: string,
  currentProjectId: string | null,
): Promise<IntentDetail> {
  const intentId = await resolveIntentId(client, idOrPrefix, currentProjectId);
  const res = await client.getIntent(intentId);
  return res.data;
}
