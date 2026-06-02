/**
 * Maintenance scheduler (ADR-035).
 *
 * Registers four `node-cron` schedules in the server process:
 *
 *   drift-agent       — daily 02:00 UTC
 *   alignment-agent   — daily 03:00 UTC
 *   gc-agent          — weekly Friday 04:00 UTC
 *   evaluation-agent  — every 15 minutes
 *
 * Each cron callback delegates to the shared `runMaintenanceAgent`
 * runner, which iterates every registered project, dispatches queued
 * intents, and persists a `maintenance_runs` row. Per-cycle observability
 * mirrors the other layers — `maintenance.run-completed` SSE events,
 * structured logging, `agent_executions`-style accounting via the
 * `maintenance_runs` table.
 *
 * `node-cron` runs in-process. These are NOT BullMQ workers; the
 * scheduled functions execute inline.
 */

import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import cron from 'node-cron';
import { simpleGit } from 'simple-git';
import { createContextLogger, BaseOrchestrator } from '@gestalt/core';
import type { QueueConfig, MaintenanceRunRecord } from '@gestalt/core';
import type { HarnessSubset } from '../types';
import { runDriftAgent } from '../agents/drift-agent';
import { runAlignmentAgent } from '../agents/alignment-agent';
import { runGCAgent } from '../agents/gc-agent';
import { runEvaluationAgent } from '../agents/evaluation-agent';
import { authenticatedGitUrl } from '../agents/util';
import { runMaintenanceAgent, loadProjectInputs } from '../runner';

const log = createContextLogger({ module: 'maintenance-scheduler' });

export interface MaintenanceSchedulerConfig {
  queueConfig: QueueConfig;
}

export type MaintenanceAgentName =
  | 'drift-agent'
  | 'alignment-agent'
  | 'gc-agent'
  | 'evaluation-agent';

/** Default schedules — overridden per-project by HARNESS.json. */
const SCHEDULE_DRIFT      = '0 2 * * *';
const SCHEDULE_ALIGNMENT  = '0 3 * * *';
const SCHEDULE_GC         = '0 4 * * 5';
const SCHEDULE_EVALUATION = '*/15 * * * *';

/**
 * Maintenance orchestrator (Amendment 2026-06 — `extends
 * BaseOrchestrator` for the structural goal of every orchestrator
 * sharing one base. context-fixer (the LLM-using maintenance agent)
 * picks up the new tool-config defaults via `loadAgentConfig` from
 * core directly).
 */
export class MaintenanceOrchestrator extends BaseOrchestrator {
  constructor() { super('maintenance-orchestrator'); }
}

export function startMaintenanceScheduler(config: MaintenanceSchedulerConfig): void {
  // Instantiate the class for future use of shared services. The
  // existing cron-driven `triggerMaintenanceRun` continues to drive
  // per-agent execution.
  new MaintenanceOrchestrator();
  cron.schedule(SCHEDULE_DRIFT,      () => void triggerMaintenanceRun({ agentName: 'drift-agent',      config }));
  cron.schedule(SCHEDULE_ALIGNMENT,  () => void triggerMaintenanceRun({ agentName: 'alignment-agent',  config }));
  cron.schedule(SCHEDULE_GC,         () => void triggerMaintenanceRun({ agentName: 'gc-agent',         config }));
  cron.schedule(SCHEDULE_EVALUATION, () => void triggerMaintenanceRun({ agentName: 'evaluation-agent', config }));
  log.info(
    {
      drift: SCHEDULE_DRIFT,
      alignment: SCHEDULE_ALIGNMENT,
      gc: SCHEDULE_GC,
      evaluation: SCHEDULE_EVALUATION,
    },
    'Maintenance scheduler started',
  );
}

/**
 * Runs a maintenance agent immediately. Used both by the cron callbacks
 * above and by the `POST /maintenance/trigger` operator endpoint.
 *
 * Pass a `scopedProjectId` to limit the run to a single project
 * (manual-trigger path); leave undefined to iterate every registered
 * project (cron path).
 */
export async function triggerMaintenanceRun(args: {
  agentName: MaintenanceAgentName;
  config: MaintenanceSchedulerConfig;
  scopedProjectId?: string;
}): Promise<MaintenanceRunRecord> {
  log.info({ agentName: args.agentName, scopedProjectId: args.scopedProjectId }, 'Maintenance run starting');
  const inputs = await loadProjectInputs(loadHarnessSubset, args.scopedProjectId);
  const agent = pickAgent(args.agentName);
  return runMaintenanceAgent({
    agentRole: args.agentName,
    projects: inputs,
    agent,
    queueConfig: args.config.queueConfig,
    ...(args.scopedProjectId ? { scopedProjectId: args.scopedProjectId } : {}),
  });
}

function pickAgent(name: MaintenanceAgentName) {
  switch (name) {
    case 'drift-agent':      return runDriftAgent;
    case 'alignment-agent':  return runAlignmentAgent;
    case 'gc-agent':         return runGCAgent;
    case 'evaluation-agent': return runEvaluationAgent;
  }
}

/**
 * Shallow-clones the project repo and reads `HARNESS.json` so the
 * maintenance agents can resolve their per-project config (schedules,
 * monitoring adapter, thresholds). Returns `null` for projects with no
 * HARNESS.json yet; the runner uses the package's defaults in that case.
 */
async function loadHarnessSubset(args: {
  projectId: string;
  gitUrl: string;
  token: string;
}): Promise<HarnessSubset | null> {
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-maintharness-${args.projectId}-`));
  try {
    await simpleGit().clone(
      authenticatedGitUrl(args.gitUrl, args.token),
      workDir,
      ['--depth', '1'],
    );
    const raw = await readFile(join(workDir, 'HARNESS.json'), 'utf8').catch(() => null);
    if (!raw) return null;
    return JSON.parse(raw) as HarnessSubset;
  } catch (err) {
    log.warn(
      { err, projectId: args.projectId },
      'failed to read project HARNESS.json — using defaults',
    );
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
