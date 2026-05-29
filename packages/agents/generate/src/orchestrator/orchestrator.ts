/**
 * Generate layer orchestrator — main BullMQ worker.
 *
 * Receives an intent task, drives the fixed execution graph to completion,
 * handles quality gate feedback, and dispatches the final artifact set.
 *
 * State is persisted to the database after every step so that
 * the cycle can be resumed after a crash or clarification pause.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  createWorker, dispatch, getRepositories, getLLMClient,
  createContextLogger, emitLiveEvent, QUEUE_NAMES,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig,
  Artifact, PlatformSignal, ExecutionStatus,
} from '@gestalt/core';
import { buildExecutionPlan, getReadySteps, isPlanComplete, hasPlanFailed } from './plan-builder';
import { assembleContext } from './context-assembler';
import { routeFeedback, requiresEscalation } from './feedback-router';
import { transition } from './state-machine';
import { runIntentAgent } from '../agents/intent-agent';
import { runDesignAgent } from '../agents/design-agent';
import { runContextAgent } from '../agents/context-agent';
import { runLintConfigAgent } from '../agents/lint-config-agent';
import { runCodeAgent } from '../agents/code-agent';
import { runTestAgent } from '../agents/test-agent';
import type { ExecutionPlan, AgentResult, GateFeedback, FeedbackSignal } from '../types';
import type { AgentRole } from '@gestalt/core';

/**
 * Embeds a Git personal access token into an HTTPS clone URL.
 * Mirrors the helper in `packages/server/src/routes/projects.ts` so the
 * worker and the harness-init route stay symmetric. SSH URLs pass through
 * unchanged (auth would come from the container's SSH key — out of scope).
 */
function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) {
    return gitUrl;
  }
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

const log = createContextLogger({ module: 'orchestrator' });

interface IntentTaskPayload {
  intentId: string;
  text: string;
  projectId: string;
  /**
   * Pre-set projectRoot. Reserved for resume / clarification flows that
   * already cloned a working tree. Normal first-time dispatch leaves this
   * unset and the orchestrator clones the project's Git repo into a temp
   * directory (ADR-032).
   */
  projectRoot?: string;
  clarification?: string;
  ambiguityId?: string;
  resume?: boolean;
  /**
   * Quality-gate retry context. Populated only when the gate dispatched
   * this task on a failed verdict (the feedback loop). The orchestrator
   * threads `priorSignals` into the routed specialist agents' tasks; the
   * `retryCount` is incremented by the gate before each dispatch and is
   * forwarded to the gate again so loop termination (max retries) works
   * across re-entries.
   */
  retryCount?: number;
  priorSignals?: FeedbackSignal[];
}

export const MAX_GATE_RETRIES = 3;

/**
 * Starts the orchestrator worker.
 * Called once at server startup.
 */
export function startOrchestratorWorker(queueConfig: QueueConfig): void {
  createWorker<IntentTaskPayload>(
    QUEUE_NAMES.generate,
    handleIntentTask,
    queueConfig,
    { concurrency: 3 },
  );
  log.info('Orchestrator worker started');
}

/**
 * Set the intent's status, persist it, and broadcast the transition over
 * the in-process event bus so the SSE route (`/events`) fans it out to
 * connected dashboard / CLI clients.
 */
async function transitionIntent(
  intentId: string,
  correlationId: string,
  status: 'generating' | 'in-review' | 'failed' | 'waiting-for-clarification',
): Promise<void> {
  const { intents } = getRepositories();
  await intents.updateStatus(intentId, status);
  emitLiveEvent('intent.status-changed', correlationId, { intentId, status });
}

/**
 * Handles a single intent task through the full execution graph.
 *
 * ADR-032: the orchestrator clones the project's Git repo into a fresh
 * temp directory for every cycle, runs the plan against that working
 * tree, commits any generated artifacts back to `defaultBranch` if the
 * cycle succeeded, and removes the temp dir in the finally block.
 *
 * Persistence + observability (per the 2026-05-29 orchestrator-observability
 * session):
 *  - one `agent_executions` row per step (created `running`, updated to
 *    `completed` / `failed` / `skipped` with tokens + duration)
 *  - every `result.signals` row saved into `signals`
 *  - every `result.artifacts` row saved into `artifacts`
 *  - SSE events emitted on the in-process bus at every state change
 */
async function handleIntentTask(
  message: TaskMessage<IntentTaskPayload>,
): Promise<TaskResult> {
  const { correlationId } = message;
  const payload = message.payload;
  const childLog = createContextLogger({ module: 'orchestrator', correlationId });

  childLog.info({ intentId: payload.intentId }, 'Orchestrator received intent task');

  const { intents, projects } = getRepositories();

  // Build or resume execution plan
  const plan = buildExecutionPlan(correlationId, payload.intentId);

  // Resolve projectRoot via Git clone unless the caller supplied one.
  let projectRoot = payload.projectRoot ?? null;
  let workDir: string | null = null;
  let project: Awaited<ReturnType<typeof projects.findById>> | null = null;

  try {
    project = await projects.findById(payload.projectId);
    if (!project) {
      throw new Error(
        `Project ${payload.projectId} not found — register it first via POST /projects`,
      );
    }

    if (!projectRoot) {
      const token = await projects.getCredential(project.id);
      if (!token) {
        throw new Error(`Project ${project.name} has no Git credential on file`);
      }

      workDir = await mkdtemp(join(tmpdir(), `gestalt-cycle-${correlationId}-`));
      const cloneUrl = authenticatedGitUrl(project.gitUrl, token);

      childLog.info({ projectId: project.id, workDir }, 'Cloning project repo for cycle');
      await simpleGit().clone(cloneUrl, workDir);

      // Make sure we are on the project's default branch before agents start
      // mutating the tree.
      const repo = simpleGit(workDir);
      const branches = await repo.branch();
      if (branches.current !== project.defaultBranch) {
        try {
          await repo.checkout(project.defaultBranch);
        } catch {
          // Branch may not exist on the remote yet (brand-new repo); fall
          // back to whatever clone landed on.
        }
      }

      projectRoot = workDir;
    }

    await transitionIntent(payload.intentId, correlationId, 'generating');

    const retryCount = payload.retryCount ?? 0;
    const priorSignals = payload.priorSignals ?? [];

    if (retryCount > 0) {
      childLog.info(
        { retryCount, priorSignalCount: priorSignals.length },
        'Quality-gate retry cycle — prior signals will be threaded into routed agents',
      );
    }

    // Drive the plan to completion
    await drivePlan(
      plan,
      projectRoot,
      payload.intentId,
      payload.text ?? '',
      priorSignals,
      childLog,
    );

    if (hasPlanFailed(plan)) {
      await transitionIntent(payload.intentId, correlationId, 'failed');
      return buildResult(correlationId, 'failed', plan);
    }

    if (plan.state === 'waiting_for_clarification') {
      // Intent-agent flagged a high-impact ambiguity; we have already
      // transitioned the intent to waiting-for-clarification inside the
      // step. Stop here — no artifacts to push, gate not yet appropriate.
      return buildResult(correlationId, 'completed', plan);
    }

    // All generate steps completed — commit + push artifacts to the project
    // repo so developers can `git pull` to receive them, then hand off to
    // the quality gate.
    const allArtifacts = plan.steps.flatMap((s) => s.result?.artifacts ?? []);

    if (allArtifacts.length > 0 && project) {
      const intentText = (payload.text ?? '').trim().split('\n')[0]?.slice(0, 72) ?? '';
      const retrySuffix = retryCount > 0 ? ` retry ${retryCount}/${MAX_GATE_RETRIES}` : '';
      const verb = retryCount > 0 ? 'fix' : 'feat';
      const subject = intentText
        ? `${verb}: ${intentText} [gestalt ${correlationId.slice(0, 8)}${retrySuffix}]`
        : `${verb}: generated artifacts [gestalt ${correlationId.slice(0, 8)}${retrySuffix}]`;
      await commitAndPushArtifacts({
        workDir: projectRoot,
        defaultBranch: project.defaultBranch,
        commitMessage: subject,
        artifacts: allArtifacts,
        childLog,
      });
    } else {
      childLog.info('No artifacts produced — skipping commit/push');
    }

    childLog.info('All generate steps complete, dispatching to quality gate');
    await transitionIntent(payload.intentId, correlationId, 'in-review');

    await dispatch({
      id: crypto.randomUUID(),
      correlationId,
      type: 'gate:review',
      sourceAgent: 'orchestrator',
      targetAgent: 'review-agent',
      priority: message.priority,
      payload: {
        intentId: payload.intentId,
        artifacts: allArtifacts,
        // Forward retry state so the gate can enforce maxRetries across
        // re-entries. The gate increments retryCount before dispatching
        // its own follow-up.
        retryCount,
        projectId: payload.projectId,
        text: payload.text,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    }, queueConfigFromEnv());

    return buildResult(correlationId, 'completed', plan);

  } catch (err) {
    childLog.error({ err }, 'Orchestrator error');
    await transitionIntent(payload.intentId, correlationId, 'failed').catch(() => {});
    throw err;
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Drives the execution plan step by step until all steps are done or failed.
 *
 * Each step's lifecycle:
 *   1. Create an `agent_executions` row (status=running) + emit `agent.started`
 *   2. Run the specialist agent against the assembled ContextSnapshot
 *   3. Persist every `result.signals` entry to `signals` + emit `signal.emitted`
 *   4. Persist every `result.artifacts` entry to `artifacts`
 *   5. Update the execution row to `completed` / `failed` / `skipped` with
 *      tokens + duration, and emit `agent.completed`
 *
 * If the intent-agent emits a CONTEXT_GAP, the plan state flips to
 * `waiting_for_clarification`, the intent transitions, and the loop bails
 * — no downstream steps run (handleIntentTask is responsible for noticing
 * the flag and skipping the gate dispatch).
 */
async function drivePlan(
  plan: ExecutionPlan,
  projectRoot: string,
  intentId: string,
  intentText: string,
  priorSignals: FeedbackSignal[],
  childLog: ReturnType<typeof createContextLogger>,
): Promise<void> {
  // Per the gate's feedback-router contract, only certain signal types route
  // back to generate. We attach those subset to the specialist agent the
  // router targets — passing every signal to every agent dilutes context.
  const signalsForAgent = (role: AgentRole): FeedbackSignal[] => {
    const routes: Partial<Record<string, AgentRole>> = {
      LINT_FAILURE: 'code-agent',
      TEST_FAILURE: 'code-agent',
      CONSTRAINT_VIOLATION: 'code-agent',
      CONTEXT_GAP: 'context-agent',
    };
    return priorSignals.filter((s) => routes[s.type] === role);
  };
  const MAX_ITERATIONS = 20;  // safety limit
  let iterations = 0;

  while (!isPlanComplete(plan) && !hasPlanFailed(plan)) {
    if (plan.state === 'waiting_for_clarification') return;
    if (++iterations > MAX_ITERATIONS) {
      throw new Error('Plan exceeded maximum iteration limit');
    }

    const readySteps = getReadySteps(plan);
    if (readySteps.length === 0) break;

    // Execute ready steps (parallel steps run concurrently). Each step
    // owns its own DB rows + SSE events so concurrency is safe.
    await Promise.all(
      readySteps.map(async (step) => {
        const agentRole = step.agentRole as AgentRole;
        const taskType = `generate:${agentRole}`;
        const executionId = crypto.randomUUID();
        const startedAt = new Date();
        const { executions, signals, artifacts } = getRepositories();

        step.status = 'running';
        childLog.info({ agentRole }, 'Running agent step');

        await executions.create({
          id: executionId,
          correlationId: plan.correlationId,
          intentId,
          agentRole,
          taskType,
          status: 'running',
          tokensUsed: 0,
          durationMs: null,
          startedAt,
          completedAt: null,
        });
        emitLiveEvent('agent.started', plan.correlationId, {
          executionId,
          agentRole,
          taskType,
          startedAt: startedAt.toISOString(),
        });

        try {
          const context = await assembleContext(projectRoot, plan, agentRole, intentText);
          const routedSignals = signalsForAgent(agentRole);
          const task = {
            taskId: crypto.randomUUID(),
            correlationId: plan.correlationId,
            agentRole,
            contextSnapshot: context,
            maxRetries: 2,
            priorSignals: routedSignals.length ? routedSignals : undefined,
          };

          const llmClient = getLLMClient();
          const llmCall = async (prompt: string): Promise<string> => {
            const result = await llmClient.complete({
              messages: [{ role: 'user', content: prompt }],
              correlationId: plan.correlationId,
            });
            if (!result.ok) throw new Error(result.error.message);
            return result.value.content;
          };

          const result = await runAgent(agentRole, task, llmCall);

          const stepStatus: ExecutionStatus =
            result.status === 'skipped' ? 'skipped'
              : result.status === 'failed' ? 'failed'
              : 'completed';
          step.status = result.status === 'skipped' ? 'skipped'
            : result.status === 'failed' ? 'failed' : 'completed';
          step.result = result;

          // Persist signals first so the dashboard sees a CONTEXT_GAP before
          // the agent.completed event (UX detail; either order is correct).
          for (const sig of result.signals ?? []) {
            await signals.save(sig as unknown as PlatformSignal);
            emitLiveEvent('signal.emitted', plan.correlationId, {
              executionId,
              agentRole,
              type: sig.type,
              severity: sig.severity,
              sourceAgent: sig.sourceAgent,
              message: sig.message,
            });
          }
          for (const art of result.artifacts ?? []) {
            await artifacts.save(art as unknown as Artifact);
          }

          const completedAt = new Date();
          await executions.updateStatus(executionId, stepStatus, {
            tokensUsed: result.tokensUsed,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            startedAt,
            completedAt,
          });
          emitLiveEvent('agent.completed', plan.correlationId, {
            executionId,
            agentRole,
            status: stepStatus,
            tokensUsed: result.tokensUsed,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            artifactCount: result.artifacts?.length ?? 0,
            signalCount: result.signals?.length ?? 0,
          });

          // Check for high-impact ambiguity (CONTEXT_GAP from intent-agent)
          const hasContextGap = result.signals.some(
            (s) => s.type === 'CONTEXT_GAP' && agentRole === 'intent-agent',
          );
          if (hasContextGap) {
            childLog.warn('High-impact ambiguity detected — waiting for clarification');
            plan.state = 'waiting_for_clarification';
            await transitionIntent(intentId, plan.correlationId, 'waiting-for-clarification');
          }

        } catch (err) {
          childLog.error({ err, agentRole }, 'Agent step failed');
          step.status = 'failed';
          const completedAt = new Date();
          await executions.updateStatus(executionId, 'failed', {
            durationMs: completedAt.getTime() - startedAt.getTime(),
            startedAt,
            completedAt,
          }).catch(() => undefined);
          emitLiveEvent('agent.completed', plan.correlationId, {
            executionId,
            agentRole,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    plan.updatedAt = new Date();
  }
}

/**
 * Writes generated artifacts to the working tree, commits, and pushes to
 * the project's default branch. Always run after a successful generate
 * cycle so `git pull` on the developer's machine yields the changes.
 *
 * Note: the design destination for these commits is a side branch + PR
 * created by the deploy-layer pr-agent once the quality gate has passed.
 * The pr-agent does not exist yet, so for now the orchestrator pushes
 * straight to defaultBranch to make the cycle visible. When deploy lands,
 * move this commit/push into the pr-agent and have the orchestrator hand
 * off the in-memory artifact set instead.
 */
async function commitAndPushArtifacts(args: {
  workDir: string;
  defaultBranch: string;
  commitMessage: string;
  artifacts: Array<{ path: string; content: string }>;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<void> {
  const { workDir, defaultBranch, commitMessage, artifacts, childLog } = args;
  const repo: SimpleGit = simpleGit(workDir);

  for (const artifact of artifacts) {
    const fullPath = join(workDir, artifact.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, artifact.content, 'utf8');
  }

  // Author identity is fixed so commits are clearly machine-made.
  await repo.addConfig('user.name', 'Gestalt Platform');
  await repo.addConfig('user.email', 'platform@gestalt.local');

  await repo.add('.');

  // status.files is empty when artifacts overwrote files with identical content.
  const status = await repo.status();
  if (status.files.length === 0) {
    childLog.info('Working tree clean after writing artifacts — skipping commit');
    return;
  }

  const commit = await repo.commit(commitMessage);
  await repo.push('origin', defaultBranch);
  childLog.info(
    { commitSha: commit.commit, branch: defaultBranch, fileCount: artifacts.length },
    'Generated artifacts committed and pushed',
  );
}

/**
 * Routes a task to the correct specialist agent.
 */
async function runAgent(
  agentRole: AgentRole,
  task: Parameters<typeof runIntentAgent>[0],
  llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  switch (agentRole) {
    case 'intent-agent':      return runIntentAgent(task, llmCall);
    case 'design-agent':      return runDesignAgent(task, llmCall);
    case 'context-agent':     return runContextAgent(task, llmCall);
    case 'lint-config-agent': return runLintConfigAgent(task, llmCall);
    case 'code-agent':        return runCodeAgent(task, llmCall);
    case 'test-agent':        return runTestAgent(task, llmCall);
    default:
      throw new Error(`Unknown agent role in generate layer: ${agentRole}`);
  }
}

function buildResult(
  correlationId: string,
  status: TaskResult['status'],
  plan: ExecutionPlan,
): TaskResult {
  return {
    taskId: crypto.randomUUID(),
    correlationId,
    agentRole: 'orchestrator',
    status,
    output: { planState: plan.state },
    signals: plan.steps.flatMap((s) => s.result?.signals ?? []),
    tokensUsed: plan.steps.reduce((sum, s) => sum + (s.result?.tokensUsed ?? 0), 0),
    durationMs: Date.now() - plan.createdAt.getTime(),
    completedAt: new Date(),
  };
}

function queueConfigFromEnv(): QueueConfig {
  return { redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };
}
