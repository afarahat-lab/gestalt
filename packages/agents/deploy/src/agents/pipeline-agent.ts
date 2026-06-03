/**
 * Pipeline agent — triggers the project's CI/CD pipeline and polls until
 * it reaches a terminal status.
 *
 * Triggered by `deploy:pipeline` after pr-agent has opened the PR.
 * Calls `PipelineAdapter.triggerPipeline`, then polls
 * `PipelineAdapter.getPipelineStatus` every 15 seconds up to
 * `timeoutMs` (default 10 minutes). On `passed`, the orchestrator
 * dispatches `deploy:promotion` with `targetEnvironment: 'staging'`. On
 * `failed` or `cancelled`, returns a `TEST_FAILURE` signal and lets the
 * orchestrator mark the intent `failed`. On timeout, returns a
 * `CONTEXT_GAP` signal so the operator can investigate.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  getRepositories, createContextLogger, emitLiveEvent,
} from '@gestalt/core';
import type { PlatformSignal, SignalType } from '@gestalt/core';
import { resolvePipelineAdapter } from '../adapters/resolver';
import { authenticatedGitUrl } from './util';

const log = createContextLogger({ module: 'pipeline-agent' });

const POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface PipelineAgentInput {
  correlationId: string;
  intentId: string;
  projectId: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  /**
   * Threaded forward from the orchestrator so the failure/timeout
   * alert can include it without a follow-up `intents.findById`
   * lookup. Optional for compat with legacy in-flight queue jobs.
   */
  intentText?: string;
  timeoutMs?: number;
}

export type PipelineAgentOutcome =
  | { kind: 'passed'; runId: string }
  | { kind: 'failed'; runId: string; reason: string }
  | { kind: 'cancelled'; runId: string }
  | { kind: 'timeout'; runId: string };

export interface PipelineAgentResult {
  outcome: PipelineAgentOutcome;
  signals: PlatformSignal[];
}

export async function runPipelineAgent(input: PipelineAgentInput): Promise<PipelineAgentResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { projects, deploymentEvents } = getRepositories();
  const project = await projects.findById(input.projectId);
  if (!project) throw new Error(`Project ${input.projectId} not found`);
  const token = await projects.getCredential(project.id);
  if (!token) throw new Error(`Project ${project.name} has no Git credential`);

  // Shallow clone so the resolver can read the project's HARNESS.json.
  // The pipeline runs inside the operator's CI/CD system, not here.
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-pipeline-${input.correlationId}-`));
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

    const { runId } = await adapter.triggerPipeline({
      projectId: project.id,
      branch: input.branch,
      correlationId: input.correlationId,
    });

    await deploymentEvents.append({
      correlationId: input.correlationId,
      intentId: input.intentId,
      eventType: 'pipeline-triggered',
      environment: null,
      prUrl: input.prUrl,
      prNumber: input.prNumber,
      runId,
      deploymentUrl: null,
      metadata: { branch: input.branch, adapter: adapter.type },
    });
    emitLiveEvent('deployment.updated', input.correlationId, {
      intentId: input.intentId,
      status: 'pipeline-triggered',
      runId,
      branch: input.branch,
      adapter: adapter.type,
    });

    log.info(
      { correlationId: input.correlationId, runId, adapter: adapter.type },
      'Pipeline triggered — polling for terminal status',
    );

    const startedAt = Date.now();
    let lastStatus = 'running';
    while (Date.now() - startedAt < timeoutMs) {
      const { status } = await adapter.getPipelineStatus({ runId });
      if (status !== lastStatus) {
        log.info({ correlationId: input.correlationId, runId, status }, 'Pipeline status update');
        lastStatus = status;
      }
      if (status === 'passed') {
        await deploymentEvents.append({
          correlationId: input.correlationId,
          intentId: input.intentId,
          eventType: 'pipeline-passed',
          environment: null,
          prUrl: input.prUrl,
          prNumber: input.prNumber,
          runId,
          deploymentUrl: null,
          metadata: { adapter: adapter.type },
        });
        emitLiveEvent('deployment.updated', input.correlationId, {
          intentId: input.intentId,
          status: 'pipeline-passed',
          runId,
          adapter: adapter.type,
        });
        return { outcome: { kind: 'passed', runId }, signals: [] };
      }
      if (status === 'failed' || status === 'cancelled') {
        await deploymentEvents.append({
          correlationId: input.correlationId,
          intentId: input.intentId,
          eventType: 'pipeline-failed',
          environment: null,
          prUrl: input.prUrl,
          prNumber: input.prNumber,
          runId,
          deploymentUrl: null,
          metadata: { adapter: adapter.type, status },
        });
        const reason = `Pipeline ${status}`;
        emitLiveEvent('deployment.updated', input.correlationId, {
          intentId: input.intentId,
          status: 'pipeline-failed',
          runId,
          adapter: adapter.type,
        });
        const signal = buildSignal({
          correlationId: input.correlationId,
          type: 'TEST_FAILURE',
          severity: 'high',
          message: `${reason} — runId=${runId}`,
        });

        // Brief — pipeline failures create an alert so operators can
        // submit feedback. Non-fatal: a failed alerts.create logs a
        // warning and the cycle still returns the signal (which the
        // orchestrator + retry router still handle as before).
        await createPipelineFailureAlert({
          input,
          alertType: 'pipeline-failed',
          title: 'CI pipeline failed',
          description:
            `The CI pipeline for intent ${quoteIntent(input.intentText)} ${reason.toLowerCase()}. ` +
            `Run ID: ${runId}. Review the pipeline logs and provide feedback to retry.`,
          runId,
          pipelineStatus: status,
        });

        return {
          outcome: status === 'cancelled'
            ? { kind: 'cancelled', runId }
            : { kind: 'failed', runId, reason },
          signals: [signal],
        };
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // Polling exhausted without a terminal status.
    const timeoutSignal = buildSignal({
      correlationId: input.correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      message: `Pipeline run ${runId} did not reach a terminal status within ${Math.round(timeoutMs / 1000)}s`,
    });
    emitLiveEvent('deployment.updated', input.correlationId, {
      intentId: input.intentId,
      status: 'pipeline-timeout',
      runId,
      adapter: adapter.type,
    });

    await createPipelineFailureAlert({
      input,
      alertType: 'pipeline-timeout',
      title: 'CI pipeline timed out',
      description:
        `The CI pipeline for intent ${quoteIntent(input.intentText)} did not complete within ` +
        `${Math.round(timeoutMs / 1000)}s. Run ID: ${runId}. Check the CI infrastructure ` +
        `or provide feedback to retry.`,
      runId,
      pipelineStatus: 'timeout',
    });

    return { outcome: { kind: 'timeout', runId }, signals: [timeoutSignal] };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function buildSignal(params: {
  correlationId: string;
  type: SignalType;
  severity: PlatformSignal['severity'];
  message: string;
}): PlatformSignal {
  return {
    id: crypto.randomUUID(),
    correlationId: params.correlationId,
    type: params.type,
    severity: params.severity,
    sourceAgent: 'pipeline-agent',
    message: params.message,
    autoResolvable: false,
    createdAt: new Date(),
  };
}

/**
 * Render the intent text for the alert title/description. Returns
 * the text quoted, capped at 80 chars with an ellipsis when longer.
 * Returns `(unknown intent)` when text is absent (legacy in-flight
 * jobs may not carry it).
 */
function quoteIntent(text: string | undefined): string {
  if (!text) return '(unknown intent)';
  const oneLine = text.split('\n')[0]!.trim();
  const capped = oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
  return `"${capped}"`;
}

/**
 * Persist the pipeline-failure/timeout alert. The alert payload
 * carries enough context for the dashboard's pipeline card AND for
 * the `POST /alerts/:id/pipeline-feedback` route to dispatch a
 * resume-on-branch retry without an extra lookup. Non-fatal on
 * error — the orchestrator still sees the signal and transitions
 * the intent to failed.
 */
async function createPipelineFailureAlert(params: {
  input: PipelineAgentInput;
  alertType: 'pipeline-failed' | 'pipeline-timeout';
  title: string;
  description: string;
  runId: string;
  pipelineStatus: 'failed' | 'cancelled' | 'timeout';
}): Promise<void> {
  const { input, alertType, title, description, runId, pipelineStatus } = params;
  try {
    const { alerts } = getRepositories();
    const alert = await alerts.create({
      correlationId: input.correlationId,
      intentId: input.intentId,
      type: alertType,
      severity: 'high',
      title,
      description,
      requiredAction: 'provide-feedback',
      context: {
        intentId: input.intentId,
        intentText: input.intentText ?? null,
        projectId: input.projectId,
        correlationId: input.correlationId,
        branch: input.branch,
        prUrl: input.prUrl,
        prNumber: input.prNumber,
        runId,
        pipelineStatus,
      },
    });
    emitLiveEvent('alert.created', input.correlationId, {
      alertId: alert.id,
      type: alertType,
      intentId: input.intentId,
      severity: 'high',
    });
    log.info(
      { alertId: alert.id, alertType, runId, intentId: input.intentId },
      'Pipeline failure alert created',
    );
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), runId },
      'Failed to create pipeline failure alert — operator will not see it in Alerts view',
    );
  }
}
