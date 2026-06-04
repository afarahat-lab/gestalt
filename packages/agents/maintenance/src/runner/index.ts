/**
 * Per-scheduled-run wrapper for the maintenance agents.
 *
 * Each call:
 *   1. Creates a `maintenance_runs` row (status='running').
 *   2. Iterates the supplied project list, invoking the agent for each
 *      and aggregating `intentsQueued` + `directFixes` + `findings`.
 *   3. Dispatches every queued `MaintenanceIntent` to the generate
 *      queue: writes an `intents` row (`source: 'maintenance-agent'`)
 *      and a `generate:intent` BullMQ task so the orchestrator handles
 *      it like any other intent.
 *   4. Updates the `maintenance_runs` row with the final counts +
 *      findings + duration.
 *   5. Emits a `maintenance.run-completed` SSE event so the dashboard
 *      sees the run.
 *
 * Used by both the cron schedules (`scheduler/index.ts`) and the
 * manual `POST /maintenance/trigger` endpoint.
 */

import { createHash, randomUUID } from 'crypto';
import {
  createContextLogger, dispatch, emitLiveEvent, getRepositories,
  resolveProjectCredential,
} from '@gestalt/core';
import type {
  TaskPriority, QueueConfig, MaintenanceRunRecord,
} from '@gestalt/core';
import type {
  MaintenanceAgentInput, MaintenanceAgentResult, MaintenanceIntent,
  MaintenancePriority, HarnessSubset,
} from '../types';
import { classifyMaintenanceIntent } from '../types';
import { ContextFixer } from '../agents/context-fixer';

/**
 * Max consecutive direct-fix attempts on the same finding before the
 * runner escalates to a `maintenance-stuck` alert. Each context-fixer
 * success resets the counter; each non-committed outcome (no-change,
 * truncation-guard, llm-error, file-missing) AND each thrown failure
 * counts as an attempt.
 *
 * Set deliberately low — three is enough to absorb a transient LLM
 * hiccup without letting a structurally-unfixable finding loop forever.
 */
const MAX_ATTEMPTS = 3;

/**
 * Stable identity for a recurring finding across runs. Built from the
 * intent's type, write-target file, and an 80-char evidence prefix so
 * minor LLM-paraphrasing of the suggestedAction doesn't change the
 * hash. SHA-256 hex; ~64 chars on disk.
 */
function computeFindingHash(intent: MaintenanceIntent): string {
  const target = intent.affectedFiles[0] ?? '';
  const evidencePrefix = intent.evidence.slice(0, 80);
  return createHash('sha256')
    .update(`${intent.type}:${target}:${evidencePrefix}`)
    .digest('hex');
}

/**
 * Idempotency-guarded direct-fix execution. Returns
 * `{ committed: true }` on a real fix; the caller increments the run
 * counter on that signal. All bookkeeping (skipping escalated findings,
 * upserting attempt counts, creating `maintenance-stuck` alerts) lives
 * here so the main loop stays readable.
 */
async function runDirectFix(args: {
  intent: MaintenanceIntent;
  project: MaintenanceAgentInput;
  allFindings: MaintenanceRunRecord['findings'];
}): Promise<{ committed: boolean }> {
  const { intent, project, allFindings } = args;
  const { findingAttempts } = getRepositories();
  const hash = computeFindingHash(intent);

  // Check the prior-attempt history BEFORE doing any work.
  const [prior] = await findingAttempts.getAttempts(project.projectId, [hash]);

  if (prior?.escalated) {
    // Already raised to a human — silently skip until an operator
    // resets the attempt or resolves the underlying issue.
    log.info(
      { projectId: project.projectId, findingHash: hash.slice(0, 12), intentType: intent.type },
      'Direct fix skipped — finding already escalated',
    );
    return { committed: false };
  }

  try {
    const outcome = await new ContextFixer().applyFix(intent, project);
    if (outcome.committed) {
      // Real edit shipped — clear the attempt row so the next time the
      // SAME finding fires (if it ever does), it starts at attempt 1.
      await findingAttempts.resetAttempts(project.projectId, hash);
      allFindings.push({
        type: 'direct-fix-applied',
        description: `Direct ${intent.type} fix committed to ${intent.affectedFiles[0]} (${outcome.commitSha?.slice(0, 8)})`,
        affectedFiles: [intent.affectedFiles[0] ?? ''],
        severity: 'low',
        suggestedAction: 'Pull defaultBranch to receive the change.',
      });
      return { committed: true };
    }
    // No-change / truncation-guard / llm-error / file-missing — count
    // as an attempt so we don't loop forever on a hopeless finding.
    const updated = await findingAttempts.upsertAttempt(project.projectId, hash);
    await maybeEscalate({
      hash, intent, project, allFindings, attemptCount: updated.attemptCount, reason: outcome.reason ?? 'no-change',
    });
    return { committed: false };
  } catch (fixErr) {
    // Thrown failures count as attempts too; the path guard's explicit
    // throw (e.g. for a src/ target) is the only "infinite" case but
    // structurally never repeats because we only ever feed it allowed
    // paths.
    const updated = await findingAttempts.upsertAttempt(project.projectId, hash);
    log.error(
      {
        err: fixErr,
        projectId: project.projectId,
        intentType: intent.type,
        affectedFile: intent.affectedFiles[0],
        attemptCount: updated.attemptCount,
      },
      'Direct context fix failed',
    );
    allFindings.push({
      type: 'direct-fix-failed',
      description: `Direct ${intent.type} fix failed for ${intent.affectedFiles[0]}: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`,
      affectedFiles: [intent.affectedFiles[0] ?? ''],
      severity: 'high',
      suggestedAction: 'Check server logs for the full error and apply the fix manually.',
    });
    await maybeEscalate({
      hash, intent, project, allFindings, attemptCount: updated.attemptCount, reason: 'thrown',
    });
    return { committed: false };
  }
}

/**
 * Called after every NON-committed attempt with the *post-upsert* count.
 * Escalates when we've spent the budget on the same finding — alert is
 * created on the run where the budget ran out, not on the run after.
 */
async function maybeEscalate(args: {
  hash: string;
  intent: MaintenanceIntent;
  project: MaintenanceAgentInput;
  allFindings: MaintenanceRunRecord['findings'];
  attemptCount: number;
  reason: string;
}): Promise<void> {
  const { hash, intent, project, allFindings, attemptCount, reason } = args;
  if (attemptCount < MAX_ATTEMPTS) {
    log.info(
      {
        projectId: project.projectId,
        findingHash: hash.slice(0, 12),
        intentType: intent.type,
        reason,
        attemptCount,
      },
      'Direct fix skipped — attempt counted',
    );
    return;
  }
  const { findingAttempts, alerts } = getRepositories();
  await findingAttempts.markEscalated(project.projectId, hash);
  await alerts.create({
    correlationId: randomUUID(),
    intentId: null,
    type: 'maintenance-stuck',
    severity: 'medium',
    title: `Maintenance agent cannot resolve finding (${intent.type})`,
    description:
      `The direct-fix path has attempted to address this finding ${attemptCount} times ` +
      `without success and is now escalating for manual review. ` +
      `Evidence: ${intent.evidence}`,
    requiredAction: 'review-manually',
    context: {
      projectId: project.projectId,
      intentType: intent.type,
      affectedFiles: intent.affectedFiles,
      evidence: intent.evidence,
      suggestedAction: intent.suggestedAction,
      attemptCount,
      findingHash: hash,
    },
  });
  allFindings.push({
    type: 'direct-fix-escalated',
    description: `Direct fix budget exhausted (${attemptCount} attempts) — escalated to maintenance-stuck alert. ${intent.evidence}`,
    affectedFiles: [intent.affectedFiles[0] ?? ''],
    severity: 'medium',
    suggestedAction: 'Resolve manually and clear the attempts row, or acknowledge the alert.',
  });
  log.warn(
    {
      projectId: project.projectId,
      findingHash: hash.slice(0, 12),
      intentType: intent.type,
      attemptCount,
    },
    'Direct fix budget exhausted — escalated',
  );
}

export interface RunInput {
  agentRole: string;
  /** Resolved per-project inputs the agent will receive. */
  projects: MaintenanceAgentInput[];
  /** Agent implementation (drift / alignment / gc / evaluation). */
  agent: (input: MaintenanceAgentInput) => Promise<MaintenanceAgentResult>;
  queueConfig: QueueConfig;
  /**
   * When the run targets a single project (manual trigger), pass it so
   * the `maintenance_runs` row carries `project_id`. The scheduled
   * multi-project runs leave this null.
   */
  scopedProjectId?: string;
}

const log = createContextLogger({ module: 'maintenance-runner' });

export async function runMaintenanceAgent(input: RunInput): Promise<MaintenanceRunRecord> {
  const { maintenanceRuns } = getRepositories();
  const startedAt = Date.now();

  const created = await maintenanceRuns.create({
    agentRole: input.agentRole,
    projectId: input.scopedProjectId ?? null,
    status: 'running',
    intentsQueued: 0,
    directFixes: 0,
    findings: [],
    durationMs: null,
  });

  let totalIntents = 0;
  let totalDirectFixes = 0;
  const allFindings: MaintenanceRunRecord['findings'] = [];
  const allQueued: MaintenanceIntent[] = [];

  for (const project of input.projects) {
    try {
      const result = await input.agent(project);
      totalDirectFixes += result.directFixes;
      for (const finding of result.findings) {
        allFindings.push(finding);
      }
      for (const intent of result.intentsQueued) {
        // ADR-018 routing: docs-only intents take the direct-fix path
        // (in-process, no generate loop). Code-change intents continue
        // to flow through the generate orchestrator.
        if (classifyMaintenanceIntent(intent.type) === 'context-file-update') {
          const handled = await runDirectFix({
            intent,
            project,
            allFindings,
          });
          if (handled.committed) {
            totalDirectFixes += 1;
          }
        } else {
          await dispatchMaintenanceIntent(intent, input.queueConfig);
          allQueued.push(intent);
          totalIntents += 1;
        }
      }
    } catch (err) {
      log.error(
        {
          err,
          agentRole: input.agentRole,
          projectId: project.projectId,
        },
        'Maintenance agent failed for project',
      );
      allFindings.push({
        type: 'agent-error',
        description: `${input.agentRole} threw for project ${project.projectName}: ${err instanceof Error ? err.message : String(err)}`,
        affectedFiles: [],
        severity: 'high',
        suggestedAction: 'Check server logs for the full stack trace.',
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  const completed = await maintenanceRuns.complete(created.id, {
    status: 'completed',
    intentsQueued: totalIntents,
    directFixes: totalDirectFixes,
    findings: allFindings,
    durationMs,
  });

  emitLiveEvent('maintenance.run-completed', created.id, {
    runId: created.id,
    agentRole: input.agentRole,
    projectId: input.scopedProjectId ?? null,
    intentsQueued: totalIntents,
    directFixes: totalDirectFixes,
    findingCount: allFindings.length,
    durationMs,
  });

  log.info(
    {
      runId: created.id,
      agentRole: input.agentRole,
      intentsQueued: totalIntents,
      directFixes: totalDirectFixes,
      findingCount: allFindings.length,
      queuedIntents: allQueued.map((i) => i.type),
      durationMs,
    },
    'Maintenance run completed',
  );

  return completed;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Materialises a `MaintenanceIntent` as a full intent + BullMQ task.
 *
 * Mirrors what `POST /intents` does for human intents, except:
 *   - `source` is `'maintenance-agent'`
 *   - `text` is the agent-supplied `suggestedAction` (already
 *     prefixed with `[gestalt-maintenance/<type>]`)
 */
async function dispatchMaintenanceIntent(
  intent: MaintenanceIntent,
  queueConfig: QueueConfig,
): Promise<void> {
  const { intents } = getRepositories();
  const intentId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  await intents.create({
    id: intentId,
    correlationId,
    projectId: intent.projectId,
    text: intent.suggestedAction,
    status: 'pending',
    source: 'maintenance-agent',
    priority: intent.priority,
  });

  await dispatch({
    id: crypto.randomUUID(),
    correlationId,
    type: 'generate:intent',
    sourceAgent: 'orchestrator',
    targetAgent: 'intent-agent',
    priority: toTaskPriority(intent.priority),
    payload: {
      intentId,
      text: intent.suggestedAction,
      projectId: intent.projectId,
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }, queueConfig);

  emitLiveEvent('intent.created', correlationId, {
    intentId,
    text: intent.suggestedAction,
    priority: intent.priority,
    source: 'maintenance-agent',
    maintenanceType: intent.type,
  });
}

function toTaskPriority(p: MaintenancePriority): TaskPriority {
  return p === 'low' ? 'background' : p;
}

// ─── Project loader ──────────────────────────────────────────────────────────

/**
 * Loads the full set of registered projects + their PATs + parsed
 * harness subsets into MaintenanceAgentInput shape. Skips projects with
 * no Git credential on file (they can't be cloned, so the agents would
 * fail per-project anyway).
 *
 * `loadHarnessSubset` is provided by the caller (the scheduler loads it
 * by cloning a shallow copy and reading HARNESS.json once per run; the
 * manual-trigger endpoint also passes the same function).
 */
export async function loadProjectInputs(
  loadHarnessSubset: (args: { projectId: string; gitUrl: string; token: string }) => Promise<HarnessSubset | null>,
  filterProjectId?: string,
): Promise<MaintenanceAgentInput[]> {
  const { projects } = getRepositories();
  const allProjects = filterProjectId
    ? await (async () => {
        const p = await projects.findById(filterProjectId);
        return p ? [p] : [];
      })()
    : await projects.listAll();
  const inputs: MaintenanceAgentInput[] = [];
  for (const project of allProjects) {
    const token = await resolveProjectCredential(project);
    if (!token) {
      log.warn({ projectId: project.id, name: project.name }, 'no Git credential — skipping');
      continue;
    }
    const harness = await loadHarnessSubset({
      projectId: project.id,
      gitUrl: project.gitUrl,
      token,
    });
    inputs.push({
      projectId: project.id,
      projectName: project.name,
      projectGitUrl: project.gitUrl,
      token,
      defaultBranch: project.defaultBranch,
      harness: harness ?? {},
    });
  }
  return inputs;
}
