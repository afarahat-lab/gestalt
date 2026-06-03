/**
 * PR agent — opens the merge request that proposes the cycle's changes.
 *
 * Triggered by the gate dispatching `deploy:pr` on a `pass` verdict.
 * Clones the project, creates a feature branch
 * (`gestalt/<corr8>-<intent-slug>`), writes all artifacts produced by
 * the generate cycle, commits + pushes that branch, then calls
 * `PipelineAdapter.createPullRequest` (ADR-033 — never a direct API
 * call). On success, appends a `pr-opened` row to `deployment_events`,
 * emits a `deployment.updated` SSE event, and dispatches
 * `deploy:pipeline` so the pipeline-agent can take over.
 *
 * On failure the deploy-orchestrator catches the throw and transitions
 * the intent to `failed`.
 */

import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  getRepositories, createContextLogger, emitLiveEvent,
} from '@gestalt/core';
import { resolvePipelineAdapter } from '../adapters/resolver';
import { authenticatedGitUrl, branchNameFor } from './util';
import { execCommand } from './exec';

const log = createContextLogger({ module: 'pr-agent' });

/**
 * Hint object pr-agent reads on the self-healing recovery path
 * (Option B). Each field is independently optional; unknown keys
 * are silently ignored so newer LLM diagnoses can ship additional
 * hints without an old worker crashing.
 */
export interface PRAgentSelfHealingHints {
  /** Run `git fetch --unshallow` on the remote branch before any push. */
  unshallow?: boolean;
  /** Push with `--force-with-lease` instead of fast-forward. */
  forceWithLease?: boolean;
  /** Skip the artifact rewrite + lockfile sync — push whatever's on the branch. */
  skipArtifactRewrite?: boolean;
  /** Rebase the resume branch on `defaultBranch` before pushing. */
  rebaseBranch?: boolean;
}

export interface PRAgentInput {
  correlationId: string;
  intentId: string;
  projectId: string;
  intentText: string;
  artifacts: Array<{ path: string; content: string }>;
  /**
   * Pipeline-feedback resume flow: when set, pr-agent checks out
   * this existing branch (instead of cutting a new one from
   * `defaultBranch`), commits the regenerated artifacts as a `fix:`
   * commit, and pushes. The PR is already open from the original
   * cycle — no `createPullRequest` call, no new branch. The caller
   * (orchestrator) carries the existing PR coordinates forward via
   * `prNumber` / `prUrl` so the deployment-events row is consistent.
   */
  resumeOnBranch?: string;
  prNumber?: number | null;
  prUrl?: string | null;
  /**
   * Self-healing hint object (Option B — migration 020 amendment).
   * Forwarded from `payload.selfHealingHints`. Only consulted on
   * the resume path (where `resumeOnBranch` is set); fresh cycles
   * ignore it. Agents apply only the hints they recognise.
   */
  selfHealingHints?: PRAgentSelfHealingHints;
  /**
   * The diagnostician's diagnosis string. Logged on the resume
   * path so operators can see why the loop dispatched here.
   */
  selfHealingDiagnosis?: string;
}

export interface PRAgentResult {
  prUrl: string;
  prNumber: number;
  branch: string;
  commitSha: string;
}

export async function runPRAgent(input: PRAgentInput): Promise<PRAgentResult> {
  const { intents, projects, deploymentEvents } = getRepositories();
  const project = await projects.findById(input.projectId);
  if (!project) {
    throw new Error(`Project ${input.projectId} not found`);
  }
  const token = await projects.getCredential(project.id);
  if (!token) {
    throw new Error(`Project ${project.name} has no Git credential on file`);
  }

  // pr-agent owns the transition `approved → deploying` — first deploy-
  // layer step to do real work.
  await intents.updateStatus(input.intentId, 'deploying');
  emitLiveEvent('intent.status-changed', input.correlationId, {
    intentId: input.intentId,
    status: 'deploying',
  });

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-pr-${input.correlationId}-`));
  try {
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    log.info({ correlationId: input.correlationId, workDir }, 'Cloning project repo for PR');
    await simpleGit().clone(cloneUrl, workDir);

    const repo: SimpleGit = simpleGit(workDir);
    // Two paths:
    //   - Fresh cycle: cut a new feature branch off `defaultBranch`.
    //   - Resume on existing branch (pipeline-feedback flow): check
    //     out the persisted branch so we commit the fix on top of
    //     the existing PR's history. The original PR stays open;
    //     the orchestrator forwards the existing PR coordinates.
    let branch: string;
    const isResume = Boolean(input.resumeOnBranch);
    // Self-healing hints — read once at the top of the resume
    // branch. Forward-compatible: only the keys this agent knows
    // about have effect; unknown keys are silently ignored. Fresh
    // cycles never look at this object.
    const hints = (input.selfHealingHints ?? {}) as PRAgentSelfHealingHints;
    const appliedHints: string[] = [];
    if (isResume) {
      branch = input.resumeOnBranch!;
      log.info(
        {
          correlationId: input.correlationId,
          branch,
          prNumber: input.prNumber ?? null,
          hints: Object.keys(hints),
          diagnosis: input.selfHealingDiagnosis ?? null,
        },
        'Resuming on existing branch (pipeline-feedback or self-healing flow)',
      );

      // Hint: unshallow the local clone so any subsequent
      // force-with-lease / rebase can see the full history.
      // Best-effort — on a fresh clone the fetch with --unshallow
      // typically completes in <1s, but a non-shallow repo
      // returns "fatal: --unshallow on a complete repository
      // does not make sense" which we swallow cleanly.
      if (hints.unshallow) {
        try {
          await repo.fetch(['origin', branch, '--unshallow']);
          appliedHints.push('unshallow');
        } catch (unshErr) {
          log.warn(
            { err: unshErr instanceof Error ? unshErr.message : String(unshErr) },
            'unshallow hint failed — continuing (non-fatal)',
          );
        }
      }

      // Fetch + checkout the remote branch. simple-git's checkout
      // resolves remote refs by name, so this works even though the
      // shallow clone didn't include it as a local branch.
      await repo.fetch('origin', branch);
      await repo.checkout(['-B', branch, `origin/${branch}`]);

      // Hint: rebase on default branch before pushing. The aborts
      // pattern matches the brief — try the rebase; if it fails
      // (merge conflict the LLM couldn't anticipate), abort and
      // continue without rebasing. Push will still attempt; if
      // it's a non-ff and forceWithLease isn't set, the push
      // failure will trigger the LLM recovery path.
      if (hints.rebaseBranch) {
        try {
          await repo.fetch(['origin', project.defaultBranch]);
          await repo.rebase([`origin/${project.defaultBranch}`]);
          appliedHints.push('rebaseBranch');
        } catch (rebErr) {
          await repo.rebase(['--abort']).catch(() => undefined);
          log.warn(
            { err: rebErr instanceof Error ? rebErr.message : String(rebErr) },
            'rebase hint failed — continuing without rebase',
          );
        }
      }
    } else {
      try {
        await repo.checkout(project.defaultBranch);
      } catch {
        // Branch may not exist on the remote yet — proceed on current HEAD.
      }
      branch = branchNameFor(input.correlationId, input.intentText);
      await repo.checkoutLocalBranch(branch);
    }

    // Hint: skip artifact rewrite + lockfile sync entirely. Used
    // when the diagnosis is "the code is fine, the push failed" —
    // we just need to (re-)push whatever's already on the branch
    // tip. Fresh cycles always write artifacts; the hint is only
    // checked on the resume branch.
    const skipRewrite = isResume && Boolean(hints.skipArtifactRewrite);
    if (skipRewrite) {
      appliedHints.push('skipArtifactRewrite');
    } else {
      // Write every artifact at its declared path. mkdir -p the dirname
      // each time — the path may be several levels deep.
      for (const artifact of input.artifacts) {
        const full = join(workDir, artifact.path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, artifact.content, 'utf8');
      }

      // Sync the lockfile against the freshly-written package.json so the
      // CI's `pnpm install --frozen-lockfile` step passes. Three cases:
      //
      //   1. Fresh project — code-agent scaffolded package.json; this run
      //      creates pnpm-lock.yaml for the first time.
      //   2. Dependency update — package.json gained/lost an entry; this
      //      run rewrites the lockfile to match.
      //   3. No package.json yet — skip (the dispatched intent was
      //      something else; first `gestalt run` will scaffold one).
      //
      // Failure is non-fatal: pr-agent commits whatever lockfile state
      // exists and pushes the PR. The dispatched CI run will surface a
      // real lockfile mismatch (if any) — better there than blocking the
      // PR from existing.
      await maybeSyncLockfile(workDir, input.correlationId);
    }

    await repo.addConfig('user.name', 'Gestalt Platform');
    await repo.addConfig('user.email', 'platform@gestalt.local');
    await repo.add('.');

    const status = await repo.status();
    const subject = isResume ? fixCommitMessageFor(input) : commitMessageFor(input);
    let commitSha: string;
    if (status.files.length === 0 && !skipRewrite) {
      // No diff vs the branch tip. For a fresh cycle this means the
      // artifact set was already on main (e.g. an upstream direct-push);
      // we synthesise an empty commit so the PR isn't blank. For a
      // resume cycle this means the regenerated artifacts are byte-
      // identical to what's already on the branch — also worth a
      // synthetic commit (the operator's feedback didn't produce a
      // diff, but we want a visible "we tried" entry in git log).
      const commit = await repo.commit(subject, undefined, { '--allow-empty': null });
      commitSha = commit.commit;
    } else if (status.files.length > 0) {
      const commit = await repo.commit(subject);
      commitSha = commit.commit;
    } else {
      // skipRewrite path with no diff — nothing new to commit;
      // resolve commitSha from current HEAD so the push still
      // works against a known tip.
      commitSha = (await repo.revparse(['HEAD'])).trim();
    }

    // Push: regular fast-forward by default; `--force-with-lease`
    // when hinted (typically paired with `unshallow` for the
    // non-fast-forward / rejected push pattern).
    const pushArgs = hints.forceWithLease
      ? ['--force-with-lease', '--set-upstream']
      : ['--set-upstream'];
    if (hints.forceWithLease) appliedHints.push('forceWithLease');

    try {
      await repo.push('origin', branch, pushArgs);
    } catch (pushErr) {
      // Hint-driven recovery exhausted. Hand off to the self-healing
      // loop with the NEW error context — it may diagnose a
      // different fix (e.g. previous hints were wrong) and dispatch
      // a different queue, OR escalate to a human alert. We rethrow
      // here so the deploy-orchestrator's catch block invokes its
      // own self-healing wrapper with the full deploy context
      // (signals, artifacts, intent attempt count).
      log.warn(
        {
          correlationId: input.correlationId,
          err: pushErr instanceof Error ? pushErr.message : String(pushErr),
          appliedHints,
        },
        'Push failed after applying self-healing hints — handing back to orchestrator for re-diagnosis',
      );
      throw pushErr;
    }

    if (appliedHints.length > 0) {
      log.info(
        { correlationId: input.correlationId, appliedHints, branch },
        'Self-healing hints applied successfully on resume push',
      );
    }

    if (isResume) {
      return resumePushResult({
        input, project, branch, commitSha,
        deploymentEvents,
      });
    }

    return await openPR(input, project, branch, commitSha, token, workDir, deploymentEvents);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Resume-flow result. The PR is already open — we record a new
 * `pr-opened` deployment event with the new commit SHA so the
 * dashboard's timeline shows the resume push, persist the (same)
 * branch info on the intent (idempotent), and return the existing
 * PR coordinates the caller threaded in. The orchestrator's
 * downstream `pipeline:dispatch` will re-trigger CI on this same
 * branch.
 */
async function resumePushResult(params: {
  input: PRAgentInput;
  project: { id: string; gitUrl: string; defaultBranch: string };
  branch: string;
  commitSha: string;
  deploymentEvents: ReturnType<typeof getRepositories>['deploymentEvents'];
}): Promise<PRAgentResult> {
  const { input, project, branch, commitSha, deploymentEvents } = params;
  const prUrl = input.prUrl ?? '';
  const prNumber = input.prNumber ?? 0;

  await deploymentEvents.append({
    correlationId: input.correlationId,
    intentId: input.intentId,
    eventType: 'pr-opened',
    environment: null,
    prUrl,
    prNumber,
    runId: null,
    deploymentUrl: null,
    metadata: { branch, commitSha, adapter: 'resume', resume: true },
  });

  // Persist (idempotent) — branch is unchanged, but the row's
  // updated_at moves forward so audit queries see the resume cycle
  // as activity.
  try {
    await getRepositories().intents.saveBranchInfo(input.intentId, {
      branchName: branch,
      prNumber: input.prNumber ?? null,
      prUrl: input.prUrl ?? null,
    });
  } catch (err) {
    log.warn({ err }, 'Failed to persist branch info on resume');
  }

  emitLiveEvent('deployment.updated', input.correlationId, {
    intentId: input.intentId,
    status: 'pr-open',
    prUrl,
    prNumber,
    branch,
    adapter: 'resume',
  });

  log.info(
    { correlationId: input.correlationId, branch, prNumber, projectId: project.id },
    'Pushed fix to existing branch — re-triggering pipeline',
  );

  return { prUrl, prNumber, branch, commitSha };
}

async function openPR(
  input: PRAgentInput,
  project: { id: string; gitUrl: string; defaultBranch: string },
  branch: string,
  commitSha: string,
  token: string,
  workDir: string,
  deploymentEvents: ReturnType<typeof getRepositories>['deploymentEvents'],
): Promise<PRAgentResult> {
  const adapter = await resolvePipelineAdapter({
    projectRoot: workDir,
    projectGitUrl: project.gitUrl,
    token,
    correlationId: input.correlationId,
  });

  const { prUrl, prNumber } = await adapter.createPullRequest({
    projectId: project.id,
    title: titleFor(input.intentText),
    body: bodyFor(input),
    head: branch,
    base: project.defaultBranch,
  });

  await deploymentEvents.append({
    correlationId: input.correlationId,
    intentId: input.intentId,
    eventType: 'pr-opened',
    environment: null,
    prUrl,
    prNumber,
    runId: null,
    deploymentUrl: null,
    metadata: { branch, commitSha, adapter: adapter.type },
  });

  // Persist branch + PR coordinates on the intent row so the
  // pipeline-feedback flow can resume on the SAME branch later.
  // Non-fatal on failure — the PR is open, the cycle continues; the
  // resume path will just fall back to the legacy "new branch"
  // behaviour if a future pipeline failure hits before this lands.
  try {
    await getRepositories().intents.saveBranchInfo(input.intentId, {
      branchName: branch,
      prNumber,
      prUrl,
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), intentId: input.intentId },
      'Failed to persist branch info on intent — resume-on-branch flow will fall back to new branch',
    );
  }

  emitLiveEvent('deployment.updated', input.correlationId, {
    intentId: input.intentId,
    status: 'pr-open',
    prUrl,
    prNumber,
    branch,
    adapter: adapter.type,
  });

  log.info(
    { correlationId: input.correlationId, prUrl, prNumber, branch, adapter: adapter.type },
    'PR opened',
  );

  return { prUrl, prNumber, branch, commitSha };
}

function titleFor(intentText: string): string {
  const t = intentText.trim().split('\n')[0] ?? intentText;
  return t.length > 72 ? `${t.slice(0, 69)}...` : t;
}

function commitMessageFor(input: PRAgentInput): string {
  const intentLine = (input.intentText ?? '').trim().split('\n')[0]?.slice(0, 72) ?? '';
  return intentLine
    ? `feat: ${intentLine} [gestalt ${input.correlationId.slice(0, 8)}]`
    : `feat: generated artifacts [gestalt ${input.correlationId.slice(0, 8)}]`;
}

/** Resume-cycle commit subject — distinct `fix:` prefix so the
 *  squash-merge history reads as "feature commit + fix commit(s)"
 *  instead of duplicate `feat:` entries that look like the
 *  operator pressed Retry by accident. */
function fixCommitMessageFor(input: PRAgentInput): string {
  const intentLine = (input.intentText ?? '').trim().split('\n')[0]?.slice(0, 60) ?? '';
  const corr = input.correlationId.slice(0, 8);
  return intentLine
    ? `fix: address CI failure — ${intentLine} [gestalt ${corr}]`
    : `fix: address CI failure [gestalt ${corr}]`;
}

/**
 * Sync the project's `pnpm-lock.yaml` against `package.json` so the
 * dispatched CI run's `pnpm install --frozen-lockfile` passes.
 *
 * Three skip paths:
 *   - `package.json` is missing — no Node project yet, nothing to do.
 *   - `pnpm` isn't on the runner — log a warning and proceed; the CI
 *     will surface any actual mismatch.
 *   - Install fails for any other reason (registry timeout, OOM, bad
 *     manifest) — log a warning and proceed; CI is the source of
 *     truth for "is this lockfile actually good".
 *
 * Skipping is intentional: a lockfile sync failure here is not worth
 * blocking the PR from being created. The PR's CI run is the real
 * verification.
 */
async function maybeSyncLockfile(workDir: string, correlationId: string): Promise<void> {
  const packageJsonPath = join(workDir, 'package.json');
  try {
    await stat(packageJsonPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.info({ correlationId }, 'No package.json present — skipping pnpm install');
      return;
    }
    log.warn({ err, correlationId }, 'Could not stat package.json — skipping pnpm install');
    return;
  }

  log.info({ correlationId, workDir }, 'Running pnpm install to sync lockfile');
  try {
    // `--no-frozen-lockfile` — pr-agent's job is to PRODUCE a lockfile
    // that matches the just-written package.json, not to enforce one.
    // CI does the enforcement via `--frozen-lockfile` against the
    // committed result.
    await execCommand('pnpm', ['install', '--no-frozen-lockfile'], workDir);
    log.info({ correlationId }, 'pnpm install completed');
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'pnpm install failed — committing without lockfile update',
    );
  }
}

function bodyFor(input: PRAgentInput): string {
  const lines = [
    '## Intent',
    '',
    input.intentText,
    '',
    '## Artifacts produced',
    '',
    ...input.artifacts.map((a) => `- \`${a.path}\``),
    '',
    '## Cycle artifacts',
    '',
    `Intent spec, design spec, and review are scoped under \`.gestalt/${input.correlationId}/\` so parallel intents don't collide on these paths.`,
    '',
    '## Correlation',
    '',
    `gestalt-${input.correlationId}`,
    '',
    '> Generated automatically by the Gestalt platform.',
  ];
  return lines.join('\n');
}
