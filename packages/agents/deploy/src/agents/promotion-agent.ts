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
} from '@gestalt/core';
import type { PlatformSignal, SignalType, DeploymentEventType } from '@gestalt/core';
import { resolvePipelineAdapter } from '../adapters/resolver';
import { authenticatedGitUrl } from './util';

const log = createContextLogger({ module: 'promotion-agent' });

export interface PromotionAgentInput {
  correlationId: string;
  intentId: string;
  projectId: string;
  targetEnvironment: 'staging' | 'production';
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
  const token = await projects.getCredential(project.id);
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
