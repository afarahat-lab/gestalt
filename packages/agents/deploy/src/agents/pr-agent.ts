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

export interface PRAgentInput {
  correlationId: string;
  intentId: string;
  projectId: string;
  intentText: string;
  artifacts: Array<{ path: string; content: string }>;
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
    // Land on the project default branch first, then cut the feature
    // branch from there. New repos may not have it yet — fall back to
    // whatever the clone landed on.
    try {
      await repo.checkout(project.defaultBranch);
    } catch {
      // Branch may not exist on the remote yet — proceed on current HEAD.
    }

    const branch = branchNameFor(input.correlationId, input.intentText);
    await repo.checkoutLocalBranch(branch);

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

    await repo.addConfig('user.name', 'Gestalt Platform');
    await repo.addConfig('user.email', 'platform@gestalt.local');
    await repo.add('.');

    const status = await repo.status();
    if (status.files.length === 0) {
      // No diff vs the current default-branch tip — the artifact set was
      // already on main (e.g. the generate orchestrator's transitional
      // direct-push). Synthesise an empty commit so the PR isn't blank.
      const commit = await repo.commit(commitMessageFor(input), undefined, {
        '--allow-empty': null,
      });
      await repo.push('origin', branch, ['--set-upstream']);
      return await openPR(input, project, branch, commit.commit, token, workDir, deploymentEvents);
    }

    const commit = await repo.commit(commitMessageFor(input));
    await repo.push('origin', branch, ['--set-upstream']);
    return await openPR(input, project, branch, commit.commit, token, workDir, deploymentEvents);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
