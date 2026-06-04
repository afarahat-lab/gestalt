/**
 * Promotion agent — moves a passed pipeline through staging, then
 * production.
 *
 * Triggered by `deploy:promotion` with `targetEnvironment: 'staging' |
 * 'production'`.
 *
 * ADR-034 (hard, unconditional, no override):
 *   when `targetEnvironment === 'production'` the agent rejects the
 *   promotion unless a `promoted-staging` row exists in
 *   `deployment_events` for the same correlationId. The check is
 *   enforced in the application layer here and re-enforced by the
 *   `deployment_events` append-only DB grant — there is no
 *   configuration knob that turns it off.
 *
 * On success the agent records a `promoted-staging` /
 * `promoted-production` event, emits `deployment.updated`, and lets the
 * orchestrator decide what to dispatch next (another promotion for
 * staging, intent → `deployed` for production).
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  getRepositories, createContextLogger, emitLiveEvent,
  createHarnessEngine, resolveProjectCredential,
} from '@gestalt/core';
import type {
  PlatformSignal, SignalType, DeploymentEventType,
  HarnessPipelineConfig,
} from '@gestalt/core';
import { resolvePipelineAdapter } from '../adapters/resolver';
import { authenticatedGitUrl } from './util';

const log = createContextLogger({ module: 'promotion-agent' });

/**
 * Hint object promotion-agent reads on self-healing recovery
 * dispatches (Option B). Unknown keys silently ignored. The
 * `retryProductionOnly` hint is consumed at the loop's
 * `buildRetryDispatch` step (it picks `targetEnvironment:
 * 'production'`); the others are logged on the agent for
 * audit visibility.
 */
export interface PromotionAgentSelfHealingHints {
  /**
   * The platform doesn't verify staging deployments today (no
   * health-check wiring), so this hint is logged but not acted
   * on. Kept on the interface so a future verifyStagingDeployment
   * step can read it without an interface change.
   */
  skipStagingVerification?: boolean;
  /**
   * Drives the loop's `buildRetryDispatch` to set
   * `targetEnvironment: 'production'` directly. Read for logging
   * here so the recovery path is visible in the agent's logs.
   */
  retryProductionOnly?: boolean;
}

export interface PromotionAgentInput {
  correlationId: string;
  intentId: string;
  projectId: string;
  targetEnvironment: 'staging' | 'production';
  /**
   * PR opened by pr-agent earlier in the cycle. Required for auto-merge
   * to run; absent → auto-merge silently skips (which is the same
   * behaviour as `autoMerge: false`).
   */
  prNumber?: number;
  /**
   * Intent text used as the merge commit subject when auto-merge fires.
   * Falls back to a generic subject when absent.
   */
  intentText?: string;
  /**
   * Self-healing hint object (Option B). Present only on retry
   * dispatches the loop produced. Fresh promotion cycles pass
   * undefined and behaviour is unchanged.
   */
  selfHealingHints?: PromotionAgentSelfHealingHints;
  /** Diagnosis string for inline logging on the recovery path. */
  selfHealingDiagnosis?: string;
}

export type PromotionAgentOutcome =
  | { kind: 'promoted'; environment: 'staging' | 'production'; deploymentUrl?: string }
  | { kind: 'blocked'; reason: 'no-staging' };

export interface PromotionAgentResult {
  outcome: PromotionAgentOutcome;
  signals: PlatformSignal[];
}

export async function runPromotionAgent(input: PromotionAgentInput): Promise<PromotionAgentResult> {
  const { projects, deploymentEvents } = getRepositories();

  // Self-healing recovery (Option B) — log applied hints. The
  // `retryProductionOnly` hint is consumed at dispatch (the loop's
  // buildRetryDispatch sets targetEnvironment: 'production'
  // directly); we surface it here so the audit trail shows it
  // applied. Unknown keys silently ignored — forward-compat.
  const hints = (input.selfHealingHints ?? {}) as PromotionAgentSelfHealingHints;
  if (input.selfHealingHints && Object.keys(input.selfHealingHints).length > 0) {
    log.info(
      {
        correlationId: input.correlationId,
        targetEnvironment: input.targetEnvironment,
        hints: Object.keys(hints),
        diagnosis: input.selfHealingDiagnosis ?? null,
      },
      'Self-healing recovery — promoting with hint context',
    );
  }

  // ADR-034 enforcement: production requires a prior successful staging
  // PromotionEvent for the same correlationId. Unconditional, no override.
  if (input.targetEnvironment === 'production') {
    const stagingPromotion = await deploymentEvents.findStagingPromotion(input.correlationId);
    if (!stagingPromotion) {
      log.warn(
        { correlationId: input.correlationId },
        'Production promotion blocked — no staging PromotionEvent exists',
      );
      const signal: PlatformSignal = {
        id: crypto.randomUUID(),
        correlationId: input.correlationId,
        type: 'GOLDEN_PRINCIPLE_BREACH' satisfies SignalType,
        severity: 'critical',
        sourceAgent: 'promotion-agent',
        message:
          'ADR-034: production promotion attempted without a confirmed staging deployment. ' +
          'This is a non-negotiable invariant and cannot be bypassed.',
        autoResolvable: false,
        createdAt: new Date(),
      };
      emitLiveEvent('deployment.updated', input.correlationId, {
        intentId: input.intentId,
        status: 'promotion-blocked',
        environment: 'production',
        reason: 'no-staging',
      });
      return { outcome: { kind: 'blocked', reason: 'no-staging' }, signals: [signal] };
    }
  }

  const project = await projects.findById(input.projectId);
  if (!project) throw new Error(`Project ${input.projectId} not found`);
  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential`);

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-promo-${input.correlationId}-`));
  try {
    await simpleGit().clone(
      authenticatedGitUrl(project.gitUrl, token),
      workDir,
      ['--depth', '1'],
    );

    const adapter = await resolvePipelineAdapter({
      projectRoot: workDir,
      projectGitUrl: project.gitUrl,
      token,
      correlationId: input.correlationId,
    });

    const { deploymentUrl } = await adapter.promoteToEnvironment({
      correlationId: input.correlationId,
      environment: input.targetEnvironment,
    });

    const eventType: DeploymentEventType = input.targetEnvironment === 'staging'
      ? 'promoted-staging'
      : 'promoted-production';

    await deploymentEvents.append({
      correlationId: input.correlationId,
      intentId: input.intentId,
      eventType,
      environment: input.targetEnvironment,
      prUrl: null,
      prNumber: null,
      runId: null,
      deploymentUrl: deploymentUrl ?? null,
      metadata: { adapter: adapter.type },
    });

    emitLiveEvent('deployment.updated', input.correlationId, {
      intentId: input.intentId,
      status: 'promoted',
      environment: input.targetEnvironment,
      deploymentUrl,
      adapter: adapter.type,
    });

    log.info(
      {
        correlationId: input.correlationId,
        environment: input.targetEnvironment,
        deploymentUrl,
        adapter: adapter.type,
      },
      'Environment promotion complete',
    );

    // Auto-merge — fires only after staging promotion succeeds, never
    // before CI passes and never on the production-promotion leg. We
    // catch every throw locally: a failed merge logs a warning and
    // leaves the PR open for manual review; the intent still reaches
    // `deployed`. The point is to avoid a GitHub API blip blocking a
    // successful deployment.
    if (input.targetEnvironment === 'staging') {
      await maybeAutoMerge({
        workDir,
        adapter,
        input,
        deploymentEvents,
      });
    }

    return {
      outcome: {
        kind: 'promoted',
        environment: input.targetEnvironment,
        ...(deploymentUrl ? { deploymentUrl } : {}),
      },
      signals: [],
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * After staging promotion, read `HARNESS.json` `pipeline.autoMerge` from
 * the cloned project. When true (and we have a `prNumber`), call
 * `adapter.mergePullRequest` and persist an `auto-merged` deployment
 * event. Non-fatal — every failure path logs + emits SSE but does NOT
 * throw, so the production-promotion dispatch continues and the intent
 * still reaches `deployed`.
 */
async function maybeAutoMerge(args: {
  workDir: string;
  adapter: { type: string; mergePullRequest: (params: {
    projectId: string;
    prNumber: number;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
  }) => Promise<{ merged: boolean; sha: string }> };
  input: PromotionAgentInput;
  deploymentEvents: ReturnType<typeof getRepositories>['deploymentEvents'];
}): Promise<void> {
  const { workDir, adapter, input, deploymentEvents } = args;

  // Read HARNESS.json from the cloned tree to find autoMerge config.
  // Parse failure is non-fatal — treat as autoMerge: false.
  let pipelineConfig: HarnessPipelineConfig | undefined;
  try {
    const harnessConfig = await createHarnessEngine(workDir).loadHarnessConfig();
    pipelineConfig = harnessConfig.pipeline;
  } catch (err) {
    log.warn(
      { err, correlationId: input.correlationId },
      'Auto-merge skipped — could not read HARNESS.json from clone',
    );
    return;
  }

  const autoMerge = pipelineConfig?.autoMerge ?? false;
  if (!autoMerge) return;
  if (input.prNumber === undefined) {
    log.warn(
      { correlationId: input.correlationId },
      'Auto-merge enabled but no prNumber in payload — skipping (legacy in-flight job?)',
    );
    return;
  }

  const mergeMethod = pipelineConfig?.mergeMethod ?? 'squash';
  const commitTitle = input.intentText
    ? `${input.intentText.split('\n')[0]?.slice(0, 72)} [gestalt ${input.correlationId.slice(0, 8)}]`
    : `Auto-merge [gestalt ${input.correlationId.slice(0, 8)}]`;

  try {
    const mergeResult = await adapter.mergePullRequest({
      projectId: input.projectId,
      prNumber: input.prNumber,
      mergeMethod,
      commitTitle,
    });

    await deploymentEvents.append({
      correlationId: input.correlationId,
      intentId: input.intentId,
      eventType: 'auto-merged' satisfies DeploymentEventType,
      environment: null,
      prUrl: null,
      prNumber: input.prNumber,
      runId: null,
      deploymentUrl: null,
      metadata: { sha: mergeResult.sha, mergeMethod, adapter: adapter.type },
    });

    emitLiveEvent('deployment.updated', input.correlationId, {
      intentId: input.intentId,
      status: 'auto-merged',
      sha: mergeResult.sha,
      prNumber: input.prNumber,
      mergeMethod,
    });

    log.info(
      {
        correlationId: input.correlationId,
        sha: mergeResult.sha,
        prNumber: input.prNumber,
        mergeMethod,
      },
      'PR auto-merged after staging promotion',
    );
  } catch (err) {
    // Auto-merge failure is non-fatal. The PR stays open; intent
    // continues to production.
    log.warn(
      { err, correlationId: input.correlationId, prNumber: input.prNumber },
      'Auto-merge failed — PR left open for manual review',
    );
    emitLiveEvent('deployment.updated', input.correlationId, {
      intentId: input.intentId,
      status: 'auto-merge-failed',
      prNumber: input.prNumber,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
