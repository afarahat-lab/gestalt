/**
 * gestalt alerts — operator commands for the oversight alert feed.
 *
 *   gestalt alerts list                    — table of unack alerts for the
 *                                            current project
 *   gestalt alerts show <alertId>          — full detail + available actions
 *   gestalt alerts fix <alertId>           — submit fix intent built from
 *                                            alert context; acknowledges
 *                                            the alert atomically
 *   gestalt alerts dismiss <alertId>       — acknowledge without action
 *
 * Project scoping: list filters client-side against the current
 * project's intents (same model the dashboard uses) — the server's
 * /alerts endpoint has no projectId filter today.
 *
 * Each subcommand accepts the standard `--server <url>` one-shot
 * override.
 */

import type { AlertSummary } from '../api/client';
import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import { c, blank, divider, prompt, printTable } from '../ui/prompts';

export async function alertsListCommand(
  options: { server?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const projectId = await resolveCurrentProjectId(client, config.currentProjectId ?? undefined);
    const [{ data: alerts }, projectIntentIds] = await Promise.all([
      client.listAlerts({ acknowledged: false }),
      projectId ? collectIntentIdsForProject(client, projectId) : Promise.resolve(new Set<string>()),
    ]);
    const scoped = projectId
      ? alerts.filter((a) => isAlertForProject(a, projectId, projectIntentIds))
      : alerts;
    blank();
    if (scoped.length === 0) {
      console.log(c.success('✓ No unacknowledged alerts'));
      blank();
      return;
    }
    const rows = scoped.map((a) => ({
      severity: severityCell(a.severity),
      type:     a.type,
      title:    a.title.length > 50 ? a.title.slice(0, 47) + '...' : a.title,
      id:       a.id.slice(0, 8),
      age:      formatAge(a.createdAt),
    }));
    printTable(rows, [
      { key: 'severity', header: 'SEVERITY', width: 12 },
      { key: 'type',     header: 'TYPE',     width: 30 },
      { key: 'title',    header: 'TITLE',    width: 55 },
      { key: 'id',       header: 'ID',       width: 10 },
      { key: 'age',      header: 'AGE',      width: 10 },
    ]);
    blank();
    console.log(c.dim(`  ${scoped.length} alert${scoped.length === 1 ? '' : 's'} requiring attention`));
    console.log(c.dim('  Use: gestalt alerts show <ID> | gestalt alerts fix <ID> | gestalt alerts dismiss <ID>'));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to list alerts: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function alertsShowCommand(
  alertId: string,
  options: { server?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const alert = await fetchAlertByIdOrPrefix(client, alertId);
    if (!alert) {
      console.log(c.error(`No alert with id (or id-prefix) '${alertId}'.`));
      process.exit(1);
    }
    printAlertDetail(alert);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to fetch alert: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function alertsFixCommand(
  alertId: string,
  options: { server?: string; context?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const alert = await fetchAlertByIdOrPrefix(client, alertId);
    if (!alert) {
      console.log(c.error(`No alert with id (or id-prefix) '${alertId}'.`));
      process.exit(1);
    }
    blank();
    console.log(c.dim(`Alert: ${alert.title}`));
    console.log(c.dim(`Type:  ${alert.type}`));
    blank();
    let additionalContext = options.context ?? '';
    if (additionalContext === '') {
      additionalContext = (await prompt('Additional context (press Enter to skip)')).trim();
    }
    blank();
    console.log(c.dim('Submitting fix intent ...'));
    const res = await client.submitAlertFixIntent(alert.id, additionalContext || undefined);
    blank();
    console.log(c.success(`✓ Fix intent submitted`));
    console.log(c.dim(`  intentId:      ${res.data.intentId}`));
    console.log(c.dim(`  correlationId: ${res.data.correlationId}`));
    console.log(c.dim(`  intent text:   "${truncate(res.data.intentText, 80)}"`));
    console.log(c.dim('  Run: gestalt status  to watch progress'));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to submit fix intent: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function alertsDismissCommand(
  alertId: string,
  options: { server?: string; notes?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const alert = await fetchAlertByIdOrPrefix(client, alertId);
    if (!alert) {
      console.log(c.error(`No alert with id (or id-prefix) '${alertId}'.`));
      process.exit(1);
    }
    blank();
    console.log(c.dim(`Alert: ${alert.title}`));
    blank();
    let notes = options.notes ?? '';
    if (notes === '') {
      notes = (await prompt('Notes (press Enter to skip)')).trim();
    }
    await client.acknowledgeAlert(alert.id, notes || undefined);
    blank();
    console.log(c.success(`✓ Alert dismissed`));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to dismiss alert: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCurrentProjectId(
  client: GestaltApiClient,
  storedProjectId?: string,
): Promise<string | null> {
  // Prefer the stored currentProjectId from CLI config (`gestalt
  // projects use`); fall back to the first project if not set.
  if (storedProjectId) return storedProjectId;
  const { data } = await client.listProjects();
  return data[0]?.id ?? null;
}

async function collectIntentIdsForProject(
  client: GestaltApiClient,
  projectId: string,
): Promise<Set<string>> {
  const { data } = await client.listIntents({ projectId, limit: 200 });
  return new Set(data.map((i) => i.id));
}

function isAlertForProject(
  a: AlertSummary,
  projectId: string,
  projectIntentIds: Set<string>,
): boolean {
  if (a.type === 'maintenance-stuck' && typeof a.context?.['projectId'] === 'string') {
    return a.context['projectId'] === projectId;
  }
  const intentId = a.intentId
    ?? (typeof a.context?.['intentId'] === 'string' ? (a.context['intentId'] as string) : null);
  if (!intentId) return true;
  return projectIntentIds.has(intentId);
}

async function fetchAlertByIdOrPrefix(
  client: GestaltApiClient,
  idOrPrefix: string,
): Promise<AlertSummary | null> {
  if (idOrPrefix.length >= 32) {
    const res = await client.getAlert(idOrPrefix);
    return res.data;
  }
  // Short prefix — list and find the unique match. Operators copy the
  // first 8 chars from `gestalt alerts list`, mirror that ergonomic
  // here.
  const { data } = await client.listAlerts({ acknowledged: false });
  const matches = data.filter((a) => a.id.startsWith(idOrPrefix));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.log(c.error(`Ambiguous id prefix '${idOrPrefix}' — matches ${matches.length} alerts. Use the full id.`));
    process.exit(1);
  }
  return matches[0] ?? null;
}

function printAlertDetail(alert: AlertSummary): void {
  blank();
  console.log(`  ${severityCell(alert.severity)}  ${c.bold(alert.type)}`);
  console.log(`  ${c.dim('id:        ')} ${alert.id}`);
  console.log(`  ${c.dim('createdAt: ')} ${new Date(alert.createdAt).toLocaleString()}`);
  blank();
  console.log(`  ${c.bold('Title')}`);
  console.log(`    ${alert.title}`);
  blank();
  console.log(`  ${c.bold('Description')}`);
  console.log(`    ${alert.description}`);
  blank();

  // Per-type extras
  if (alert.type === 'clarification-needed') {
    if (alert.intentText) {
      console.log(`  ${c.bold('Original intent')}`);
      console.log(`    "${alert.intentText}"`);
    }
    if (alert.intentStatus) {
      console.log(`  ${c.dim('Status:')} ${alert.intentStatus}`);
    }
    const suggestions = Array.isArray(alert.context?.['suggestions'])
      ? (alert.context['suggestions'] as string[])
      : [];
    if (suggestions.length > 0) {
      blank();
      console.log(`  ${c.bold('Suggestions')}`);
      for (const s of suggestions) console.log(`    • ${s}`);
    }
  }
  if (alert.type === 'maintenance-stuck') {
    if (alert.findingType) console.log(`  ${c.dim('Finding:        ')} ${alert.findingType}`);
    if (alert.attemptCount != null) console.log(`  ${c.dim('Attempts made:  ')} ${alert.attemptCount}`);
    if (alert.affectedFiles && alert.affectedFiles.length > 0) {
      console.log(`  ${c.dim('Affected files: ')} ${alert.affectedFiles.join(', ')}`);
    }
    if (alert.suggestedAction) {
      blank();
      console.log(`  ${c.bold('Suggested action')}`);
      console.log(`    ${alert.suggestedAction}`);
    }
    if (alert.evidence) {
      blank();
      console.log(`  ${c.bold('Evidence')}`);
      console.log(`    ${alert.evidence}`);
    }
  }
  if (alert.type === 'GOLDEN_PRINCIPLE_BREACH') {
    if (alert.breachAgent) console.log(`  ${c.dim('Detected by: ')} ${alert.breachAgent}`);
    if (alert.breachLocation) {
      const loc = `${alert.breachLocation.file}${alert.breachLocation.line ? ':' + alert.breachLocation.line : ''}`;
      console.log(`  ${c.dim('Location:    ')} ${loc}`);
    }
    if (alert.breachMessage) {
      blank();
      console.log(`  ${c.bold('Message')}`);
      console.log(`    ${alert.breachMessage}`);
    }
  }

  blank();
  divider();
  console.log(`  ${c.bold('Available actions:')}`);
  console.log(`    ${c.dim('gestalt alerts fix     ')} ${alert.id.slice(0, 8)}    — submit a fix intent`);
  console.log(`    ${c.dim('gestalt alerts dismiss ')} ${alert.id.slice(0, 8)}    — acknowledge without action`);
  blank();
}

function severityCell(severity: string): string {
  switch (severity) {
    case 'critical': return c.error('[critical]');
    case 'high':     return c.warn('[high]');
    case 'medium':   return c.dim('[medium]');
    case 'low':      return c.dim('[low]');
    default:         return c.dim(`[${severity}]`);
  }
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}
