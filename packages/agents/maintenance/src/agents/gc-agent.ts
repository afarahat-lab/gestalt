/**
 * GC agent — periodic cleanup of stale artifacts.
 *
 * Schedule: weekly on Friday at 04:00 UTC.
 *
 * What it removes:
 *   1. Remote `gestalt/*` branches older than 30 days. (Operators are
 *      welcome to merge a PR after a long delay; once the branch is
 *      stale enough, the platform assumes it's been superseded.)
 *   2. `.gestalt/*` spec files older than 90 days (intent specs, design
 *      specs, LLM review prose). Committed deletion.
 *   3. `deployment_events` rows older than 90 days (operational logs,
 *      not audit records — ADR-035).
 *
 * gc-agent never queues `MaintenanceIntent` objects. All work is direct,
 * recorded in `MaintenanceRunRecord.findings` so dashboards can show
 * exactly what was pruned.
 */

import { mkdtemp, readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import { createContextLogger, getRepositories } from '@gestalt/core';
import type { MaintenanceFinding } from '@gestalt/core';
import type { MaintenanceAgentInput, MaintenanceAgentResult } from '../types';
import { authenticatedGitUrl } from './util';

const log = createContextLogger({ module: 'gc-agent' });

const BRANCH_STALE_DAYS = 30;
const SPEC_STALE_DAYS = 90;
const DEPLOYMENT_EVENT_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function runGCAgent(input: MaintenanceAgentInput): Promise<MaintenanceAgentResult> {
  const findings: MaintenanceFinding[] = [];
  let directFixes = 0;

  // ─── DB-side prune (no clone needed) ───────────────────────────────────
  const { deploymentEvents } = getRepositories();
  const cutoff = new Date(Date.now() - DEPLOYMENT_EVENT_RETENTION_DAYS * MS_PER_DAY);
  try {
    const purgedRows = await deploymentEvents.gcOlderThan(cutoff);
    if (purgedRows > 0) {
      directFixes += purgedRows;
      findings.push({
        type: 'gc-deployment-events',
        description: `purged ${purgedRows} deployment_events row(s) older than ${DEPLOYMENT_EVENT_RETENTION_DAYS} days`,
        affectedFiles: [],
        severity: 'low',
        suggestedAction: '(no action required — operational log cleanup)',
      });
      log.info(
        { projectId: input.projectId, purgedRows, retentionDays: DEPLOYMENT_EVENT_RETENTION_DAYS },
        'gc-agent purged stale deployment_events rows',
      );
    }
  } catch (err) {
    log.error({ err, projectId: input.projectId }, 'deployment_events GC failed');
    findings.push({
      type: 'gc-deployment-events-failed',
      description: `failed to purge stale deployment_events rows: ${err instanceof Error ? err.message : String(err)}`,
      affectedFiles: [],
      severity: 'medium',
      suggestedAction: 'Check the application role still has DELETE permission on deployment_events (migration 005).',
    });
  }

  // ─── Repo-side prune (needs a clone) ───────────────────────────────────
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-gc-${input.projectId}-`));
  try {
    const cloneUrl = authenticatedGitUrl(input.projectGitUrl, input.token);
    await simpleGit().clone(cloneUrl, workDir);
    const repo = simpleGit(workDir);
    try {
      await repo.checkout(input.defaultBranch);
    } catch { /* new repo with no default branch yet — skip */ }

    // 1. Delete stale gestalt/* remote branches.
    const branchCutoffMs = Date.now() - BRANCH_STALE_DAYS * MS_PER_DAY;
    const remoteBranchesRaw = await repo.raw(['for-each-ref', '--format=%(refname:short) %(committerdate:unix)', 'refs/remotes/origin/gestalt/']);
    const deletedBranches: string[] = [];
    for (const line of remoteBranchesRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const ref = parts[0];
      const tsStr = parts[1];
      if (!ref || !tsStr) continue;
      const ts = parseInt(tsStr, 10) * 1000;
      if (Number.isNaN(ts) || ts >= branchCutoffMs) continue;
      const localName = ref.replace(/^origin\//, '');
      try {
        await repo.push(['origin', '--delete', localName]);
        deletedBranches.push(localName);
      } catch (err) {
        log.warn(
          { branch: localName, err: err instanceof Error ? err.message : String(err) },
          'gc-agent failed to delete remote branch',
        );
      }
    }
    if (deletedBranches.length > 0) {
      directFixes += deletedBranches.length;
      findings.push({
        type: 'gc-stale-branches',
        description: `deleted ${deletedBranches.length} stale gestalt/* branch(es) older than ${BRANCH_STALE_DAYS} days`,
        affectedFiles: deletedBranches.map((b) => `(branch) ${b}`),
        severity: 'low',
        suggestedAction: '(no action required)',
      });
      log.info(
        { projectId: input.projectId, count: deletedBranches.length },
        'gc-agent deleted stale branches',
      );
    }

    // 2. Delete stale `.gestalt/` entries older than 90 days.
    //
    // After the parallel-intent merge-conflict fix (2026-06), specs
    // live under `.gestalt/<correlationId>/{intent,design,llm-review}.*`.
    // Earlier cycles wrote flat files (`.gestalt/intent-spec.json`,
    // `.gestalt/llm-review-<corr8>.md`). This handles both shapes:
    //   - UUID-named subdirectory → rm -rf when its mtime is past the cutoff
    //   - flat file at the top level → delete when past the cutoff (legacy)
    const specCutoffMs = Date.now() - SPEC_STALE_DAYS * MS_PER_DAY;
    const gestaltDir = join(workDir, '.gestalt');
    const deletedSpecs: string[] = [];
    try {
      const entries = await readdir(gestaltDir, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(gestaltDir, entry.name);
        const info = await stat(path).catch(() => null);
        if (!info) continue;
        if (info.mtimeMs >= specCutoffMs) continue;
        if (entry.isDirectory() && isUuid(entry.name)) {
          await rm(path, { recursive: true, force: true }).catch(() => undefined);
          deletedSpecs.push(`.gestalt/${entry.name}/`);
        } else if (entry.isFile()) {
          await rm(path).catch(() => undefined);
          deletedSpecs.push(`.gestalt/${entry.name}`);
        }
      }
    } catch {
      // No .gestalt directory — nothing to do.
    }

    if (deletedSpecs.length > 0) {
      await repo.addConfig('user.name', 'Gestalt GC Agent');
      await repo.addConfig('user.email', 'gc-agent@gestalt.local');
      await repo.add('.');
      const status = await repo.status();
      if (status.files.length > 0) {
        await repo.commit(
          `chore: gc-agent removed ${deletedSpecs.length} stale .gestalt spec file(s) [gestalt-maintenance]`,
        );
        await repo.push('origin', input.defaultBranch);
        directFixes += deletedSpecs.length;
        findings.push({
          type: 'gc-stale-specs',
          description: `deleted ${deletedSpecs.length} .gestalt spec file(s) older than ${SPEC_STALE_DAYS} days`,
          affectedFiles: deletedSpecs,
          severity: 'low',
          suggestedAction: '(no action required)',
        });
        log.info(
          { projectId: input.projectId, count: deletedSpecs.length },
          'gc-agent removed stale spec files',
        );
      }
    }

    return { intentsQueued: [], directFixes, findings };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * RFC 4122 v4 UUID match. Used by the `.gestalt/` cleanup loop to
 * distinguish per-correlationId spec directories from anything else
 * an operator may have parked under `.gestalt/` (the platform owns
 * the directory but is permissive about its contents).
 */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}
