/**
 * Generate layer orchestrator — main BullMQ worker.
 *
 * Receives an intent task, drives the fixed execution graph to completion,
 * handles quality gate feedback, and dispatches the final artifact set.
 *
 * State is persisted to the database after every step so that
 * the cycle can be resumed after a crash or clarification pause.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  createWorker, dispatch, getRepositories,
  createContextLogger, emitLiveEvent, QUEUE_NAMES,
  McpClient, resolveMcpClients, createHarnessEngine,
  BaseOrchestrator,
  runSelfHealingLoop,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig,
  Artifact, PlatformSignal, ExecutionStatus, AgentRole, SignalType, SignalSeverity,
  HarnessConfig,
} from '@gestalt/core';
import { buildExecutionPlan, getReadySteps, isPlanComplete, hasPlanFailed } from './plan-builder';
import { assembleContext } from './context-assembler';
import { routeFeedback, requiresEscalation } from './feedback-router';
import { transition } from './state-machine';
import { IntentAgent } from '../agents/intent-agent';
import { DesignAgent } from '../agents/design-agent';
import { ContextAgent } from '../agents/context-agent';
import { LintConfigAgent } from '../agents/lint-config-agent';
import { CodeAgent } from '../agents/code-agent';
import { TestAgent } from '../agents/test-agent';
import type { BaseLLMAgent } from '../agents/base-llm-agent';
import { runCustomAgent } from '../agents/custom-agent-runner';
import { loadCustomAgents } from '../config/agent-config-loader';
import { scheduleCustomAgents, FRAMEWORK_AGENT_NAMES } from './custom-agent-scheduler';
import type { ContextSnapshot, CustomAgentNode } from '../types';
import type { ExecutionPlan, AgentResult, GateFeedback, FeedbackSignal } from '../types';

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
  text?: string;       // optional on the resume leg — orchestrator hydrates from DB
  projectId?: string;  // optional on the resume leg — orchestrator hydrates from DB
  /**
   * Pre-set projectRoot. Reserved for resume / clarification flows that
   * already cloned a working tree. Normal first-time dispatch leaves this
   * unset and the orchestrator clones the project's Git repo into a temp
   * directory (ADR-032).
   */
  projectRoot?: string;
  /**
   * Operator-supplied clarification text. Populated when the cycle is
   * resuming after a `waiting-for-clarification` pause. The orchestrator
   * forwards this verbatim to the intent-agent's task, where the prompt
   * builder appends it under an "Operator clarification" heading.
   */
  clarification?: string;
  ambiguityId?: string;
  resume?: boolean;
  source?: 'human' | 'maintenance-agent' | 'pipeline-feedback' | 'self-healing' | 'auto-resolved' | 'operator-resume';
  /**
   * Pipeline-feedback resume flow. When set, the orchestrator
   * checks out this branch after the per-cycle clone so the
   * code-agent's regeneration sits on top of the existing
   * branch's history. The pr-agent dispatch carries the same
   * branch (+ prNumber/prUrl) so pr-agent pushes to the same
   * branch + reuses the open PR rather than creating a new one.
   */
  resumeOnBranch?: string;
  prNumber?: number;
  prUrl?: string;
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
 * Generate-layer orchestrator (Amendment 2026-06 — `extends
 * BaseOrchestrator` for the structural goal of every orchestrator
 * sharing one base. The existing function-based handler stays —
 * `BaseOrchestrator`'s services are opt-in helpers, not a forced
 * template-method, so generate's resume / clarification / retry
 * flow remains untouched).
 */
export class GenerateOrchestrator extends BaseOrchestrator {
  constructor() { super('generate-orchestrator'); }
}

/**
 * Starts the orchestrator worker.
 * Called once at server startup.
 */
export function startOrchestratorWorker(queueConfig: QueueConfig): void {
  // Instantiate the class so future code can call its shared
  // services (`closeMcpClients`, `loadHarness`, `resolveAgentContext`).
  // The legacy `handleIntentTask` function continues to drive the
  // worker — no behaviour change for the generate layer.
  new GenerateOrchestrator();
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
  // Per-cycle MCP client cache (ADR-039). One client per unique
  // serverName; reused across agent steps (code-agent and context-
  // agent may both declare the same server). Closed in `finally` so
  // a thrown agent run can't leak transport / file descriptors.
  const mcpCache = new Map<string, McpClient>();

  try {
    // On the resume leg (POST /intents/:id/clarify) the caller only
    // sends `intentId` + `clarification`. Hydrate the missing payload
    // fields from the persisted intent record so the rest of the
    // handler sees a uniform payload regardless of entry point.
    const intentRecord = await intents.findById(payload.intentId);
    if (!intentRecord) {
      throw new Error(`Intent ${payload.intentId} not found`);
    }
    const projectId = payload.projectId ?? intentRecord.projectId;
    const intentText = payload.text ?? intentRecord.text;
    // `intentSource` carries the dispatch trigger forward to the
    // intent-agent so its clarification gate + prompt framing pick
    // the right path. The DB-side `intentRecord.source` is the
    // SUBMITTING source (human / maintenance) and never changes;
    // `payload.source` is the DISPATCH source (which is the same on
    // a fresh submit but flips to `pipeline-feedback` on the resume
    // leg). We prefer payload.source for resume context.
    const intentSource: 'human' | 'maintenance-agent' | 'pipeline-feedback' | 'self-healing' | 'auto-resolved' | 'operator-resume' =
      payload.source ?? intentRecord.source;

    project = await projects.findById(projectId);
    if (!project) {
      throw new Error(
        `Project ${projectId} not found — register it first via POST /projects`,
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

      const repo = simpleGit(workDir);

      if (payload.resumeOnBranch) {
        // Pipeline-feedback resume flow — fetch + checkout the existing
        // branch so the code-agent's regeneration sits on top of the
        // history that's already in the open PR. pr-agent will later
        // push the fix commit to this same branch and skip
        // createPullRequest.
        try {
          await repo.fetch('origin', payload.resumeOnBranch);
          await repo.checkout(['-B', payload.resumeOnBranch, `origin/${payload.resumeOnBranch}`]);
          childLog.info(
            { branch: payload.resumeOnBranch, prNumber: payload.prNumber ?? null },
            'Resuming cycle on existing branch (pipeline-feedback)',
          );
        } catch (err) {
          // If the branch vanished (operator deleted it on GitHub) fall
          // through to the default-branch path — the cycle still runs.
          childLog.warn(
            { err: err instanceof Error ? err.message : String(err), branch: payload.resumeOnBranch },
            'Failed to checkout resumeOnBranch — falling back to default branch',
          );
        }
      } else {
        // Make sure we are on the project's default branch before agents
        // start mutating the tree.
        const branches = await repo.branch();
        if (branches.current !== project.defaultBranch) {
          try {
            await repo.checkout(project.defaultBranch);
          } catch {
            // Branch may not exist on the remote yet (brand-new repo);
            // fall back to whatever clone landed on.
          }
        }
      }

      projectRoot = workDir;
    }

    await transitionIntent(payload.intentId, correlationId, 'generating');

    // Read HarnessConfig from the cloned tree — ADR-039 token
    // resolution may need `mcp.servers[].token` entries declared in
    // HARNESS.json (the `tokenFrom: 'harness'` source).
    let harnessConfig: HarnessConfig | null = null;
    try {
      const snap = await createHarnessEngine(projectRoot).buildSnapshot(correlationId);
      harnessConfig = snap.harness;
    } catch (err) {
      childLog.warn({ err }, 'Could not read HARNESS.json — MCP harness-source tokens unavailable');
    }
    // Project Git PAT — feeds the `tokenFrom: 'project_credential'`
    // source. Already loaded if we cloned ourselves; for the resume
    // path (payload.projectRoot supplied) we look it up.
    const projectCredential = await projects.getCredential(project.id);

    const retryCount = payload.retryCount ?? 0;
    const priorSignals = payload.priorSignals ?? [];

    if (retryCount > 0) {
      childLog.info(
        { retryCount, priorSignalCount: priorSignals.length },
        'Quality-gate retry cycle — prior signals will be threaded into routed agents',
      );
    }

    // The DB is the source of truth for clarification text. /clarify
    // calls `intents.saveClarification` before dispatching, so the
    // persisted column is populated on the very first resume AND on
    // every subsequent gate-retry dispatch (where the BullMQ payload
    // does not carry it). Fall back to `payload.clarification` only
    // if the DB read somehow missed it (e.g. a worker pulled the
    // message before the UPDATE committed — very rare).
    const clarificationText = intentRecord.clarification ?? payload.clarification ?? undefined;

    // ─── Schedule custom agents (ADR-037, runs_after enforcement) ────
    // Load + topologically sort custom-agent definitions BEFORE
    // drivePlan so an operator config error fails fast with a typed
    // CONTEXT_GAP signal and a clear message — no half-executed cycle
    // to clean up. The two maps drive interleaved execution inside
    // drivePlan: after each framework step completes, customs that
    // depend on it run, then customs that depend on those run, and so
    // on through the resolved chain.
    const customAgentDefs = await loadCustomAgents(projectRoot);
    let scheduledCustomAgents: CustomAgentNode[];
    try {
      scheduledCustomAgents = scheduleCustomAgents(customAgentDefs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      childLog.error({ err }, 'Custom agent scheduling failed — emitting CONTEXT_GAP');
      const { signals: signalsRepo } = getRepositories();
      await signalsRepo.save({
        id: crypto.randomUUID(),
        correlationId,
        type: 'CONTEXT_GAP',
        severity: 'high',
        sourceAgent: 'context-agent',
        message: `Invalid custom agent configuration: ${message}`,
        autoResolvable: false,
        createdAt: new Date(),
      } as PlatformSignal);
      emitLiveEvent('signal.emitted', correlationId, {
        agentRole: 'context-agent',
        type: 'CONTEXT_GAP',
        severity: 'high',
        sourceAgent: 'context-agent',
        message,
      });
      await transitionIntent(payload.intentId, correlationId, 'failed');
      return buildResult(correlationId, 'failed', plan);
    }

    // Build the two adjacency maps the per-step interleave reads.
    // `customAgentsAfter[frameworkAgent]` → customs that run when
    // that framework agent completes. `customAgentsAfterCustom[
    // customName]` → customs that run when that custom completes.
    // We split because the two map keys have different semantics —
    // framework agents are roles in the fixed plan; custom agents
    // are runtime-scheduled.
    const customAgentsAfter = new Map<string, CustomAgentNode[]>();
    const customAgentsAfterCustom = new Map<string, CustomAgentNode[]>();
    for (const node of scheduledCustomAgents) {
      if (FRAMEWORK_AGENT_NAMES.has(node.dependsOn)) {
        const list = customAgentsAfter.get(node.dependsOn) ?? [];
        list.push(node);
        customAgentsAfter.set(node.dependsOn, list);
      } else {
        const list = customAgentsAfterCustom.get(node.dependsOn) ?? [];
        list.push(node);
        customAgentsAfterCustom.set(node.dependsOn, list);
      }
    }

    // Self-healing skip list (migration 020). Only honoured when
    // the resume context was written by `runSelfHealingLoopUnsafe`
    // at HIGH confidence — the loop clears `skipAgents` for any
    // lower confidence before persisting, so we can trust whatever
    // is on the row. We additionally double-check `autoHealed` here
    // (operator-feedback resumes set autoHealed:false and never
    // populate skipAgents — belt-and-braces).
    const resumeCtx = intentRecord.lastResumeContext as unknown as {
      autoHealed?: boolean; skipAgents?: string[];
    } | null;
    const selfHealingSkipAgents =
      resumeCtx?.autoHealed && Array.isArray(resumeCtx.skipAgents)
        ? resumeCtx.skipAgents
        : undefined;

    // Drive the plan to completion
    await drivePlan(
      plan,
      projectRoot,
      payload.intentId,
      intentText,
      priorSignals,
      childLog,
      {
        intentSource,
        clarification: clarificationText,
        mcpCache,
        harnessConfig,
        projectCredential,
        customAgentsAfter,
        customAgentsAfterCustom,
        skipAgents: selfHealingSkipAgents,
      },
    );

    if (hasPlanFailed(plan)) {
      // Self-healing wraps the failed-plan exit (migration 020). If
      // the loop dispatches a retry OR auto-resolves an escalated
      // alert, the intent stays in `generating`; otherwise we
      // transition to `failed` exactly as before.
      const healing = await attemptSelfHealingForGenerate(
        payload.intentId,
        correlationId,
        'Generate plan finished with failed step(s)',
        undefined,
        childLog,
      );
      if (!healing.retryDispatched) {
        await transitionIntent(payload.intentId, correlationId, 'failed');
      }
      return buildResult(correlationId, healing.retryDispatched ? 'completed' : 'failed', plan);
    }

    if (plan.state === 'waiting_for_clarification') {
      // Intent-agent flagged a high-impact ambiguity; we have already
      // transitioned the intent to waiting-for-clarification inside the
      // step. Stop here — no artifacts to push, gate not yet appropriate.
      return buildResult(correlationId, 'completed', plan);
    }

    // All generate steps completed. The artifact set is forwarded in the
    // gate dispatch payload below and eventually passed to pr-agent in
    // the deploy:pr message; pr-agent owns the only commit + push (to a
    // PR branch, not defaultBranch). The generate orchestrator therefore
    // never mutates the project's Git tree.
    const allArtifacts = plan.steps.flatMap((s) => s.result?.artifacts ?? []);

    // Custom agents (ADR-037 + runs_after enforcement) ran inline
    // inside drivePlan — interleaved after the framework agent each
    // declared `runs_after` against (default: test-agent). No
    // separate post-cycle loop here anymore.

    childLog.info(
      { artifactCount: allArtifacts.length, retryCount },
      'All generate steps complete, dispatching to quality gate',
    );
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
        projectId,
        text: intentText,
        // Pipeline-feedback resume: forward to the gate so it can pass
        // through to its `deploy:pr` dispatch on a pass verdict. pr-agent
        // then sees `resumeOnBranch` and pushes to the existing branch
        // instead of opening a new PR.
        resumeOnBranch: payload.resumeOnBranch,
        prNumber: payload.prNumber,
        prUrl: payload.prUrl,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    }, queueConfigFromEnv());

    return buildResult(correlationId, 'completed', plan);

  } catch (err) {
    // Sentinel: an inline self-healing dispatcher (e.g. the
    // custom-agent failure path) already queued a retry. Return
    // cleanly without re-running self-healing (which would
    // duplicate the dispatch).
    if (err instanceof SelfHealingRetryDispatched) {
      childLog.info({ source: err.source }, 'Cycle bailed — self-healing retry already queued');
      return {
        taskId: crypto.randomUUID(),
        correlationId,
        agentRole: 'orchestrator',
        status: 'completed',
        output: { planState: 'self-healed' },
        signals: [],
        tokensUsed: 0,
        durationMs: 0,
        completedAt: new Date(),
      };
    }
    childLog.error({ err }, 'Orchestrator error');
    // Self-healing wraps the catch block (migration 020). If the
    // loop dispatches a retry, we DON'T transition to failed and
    // DON'T re-throw (BullMQ would otherwise retry the original
    // job, double-dispatching the cycle). On escalation without
    // auto-resolve we still transition to failed and return
    // cleanly — the alert carries the human-attention signal.
    const healing = await attemptSelfHealingForGenerate(
      payload.intentId,
      correlationId,
      'Orchestrator threw',
      err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      childLog,
    ).catch(() => ({ retryDispatched: false }));
    if (!healing.retryDispatched) {
      await transitionIntent(payload.intentId, correlationId, 'failed').catch(() => {});
    }
    // Don't re-throw — see comment above. Return a TaskResult so
    // BullMQ marks the job done.
    return {
      taskId: crypto.randomUUID(),
      correlationId,
      agentRole: 'orchestrator',
      status: healing.retryDispatched ? 'completed' : 'failed',
      output: { planState: 'error' },
      signals: [],
      tokensUsed: 0,
      durationMs: 0,
      completedAt: new Date(),
    };
  } finally {
    // ADR-039 — close every MCP client this cycle opened. Best-
    // effort; a thrown close shouldn't mask the original error path.
    if (mcpCache.size > 0) {
      await Promise.all(
        Array.from(mcpCache.values()).map((c) =>
          c.close().catch(() => undefined),
        ),
      );
    }
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
interface DrivePlanOptions {
  intentSource: 'human' | 'maintenance-agent' | 'pipeline-feedback' | 'self-healing' | 'auto-resolved' | 'operator-resume';
  clarification?: string;
  /**
   * ADR-039 — per-cycle MCP client cache. Keyed by `serverName`.
   * `resolveMcpForAgent` populates it lazily the first time any
   * agent declares a given server; later agent steps reuse the
   * cached client. The orchestrator's `finally` block closes every
   * entry once the cycle is over.
   */
  mcpCache: Map<string, McpClient>;
  /**
   * HarnessConfig read from the cloned tree. Feeds the
   * `tokenFrom: 'harness'` resolver source. `null` only when
   * HARNESS.json failed to parse (the cycle still runs; MCP servers
   * relying on harness tokens simply connect anonymously).
   */
  harnessConfig: HarnessConfig | null;
  /**
   * Project Git PAT. Feeds the `tokenFrom: 'project_credential'`
   * source. `null` when the project has no credential on file (e.g.
   * a public-repo registration); MCP servers asking for it will
   * connect anonymously.
   */
  projectCredential: string | null;
  /**
   * Self-healing skip list (migration 020) — agent roles whose
   * prior output the most recent high-confidence diagnosis said is
   * still valid. Loaded from `intent.lastResumeContext.skipAgents`
   * at the top of `handleIntentTask`. Honoured only when the
   * resume context is `autoHealed: true` AND the confidence was
   * `'high'` — the loop's `runSelfHealingLoopUnsafe` enforces this
   * before writing the list.
   */
  skipAgents?: string[];
  /**
   * ADR-037 — custom agents that declared `runs_after: <framework>`.
   * Map key is the framework agent name; value is every custom node
   * the scheduler resolved to that key. The orchestrator runs them
   * (in declaration order) immediately after the matching framework
   * step's status transitions to `completed` / `skipped`.
   */
  customAgentsAfter: Map<string, CustomAgentNode[]>;
  /**
   * Same shape, keyed by custom agent name — drives the recursive
   * chain `customA → customB → customC`. Walked from
   * `runDependentCustomAgents` with a depth cap.
   */
  customAgentsAfterCustom: Map<string, CustomAgentNode[]>;
}

async function drivePlan(
  plan: ExecutionPlan,
  projectRoot: string,
  intentId: string,
  intentText: string,
  priorSignals: FeedbackSignal[],
  childLog: ReturnType<typeof createContextLogger>,
  opts: DrivePlanOptions,
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
        const { executions, signals, artifacts, executionLogs } = getRepositories();

        // Self-healing skipAgents (migration 020). When a previous
        // self-healing diagnosis ran at high confidence and listed
        // this agent role in `skipAgents`, we skip the step entirely
        // — the diagnosis says its prior output is still valid. We
        // still create the `agent_executions` row (status=skipped)
        // for the dashboard's accordion. opts.skipAgents is loaded
        // by handleIntentTask from intent.lastResumeContext.
        if (opts.skipAgents && opts.skipAgents.includes(agentRole)) {
          step.status = 'skipped';
          childLog.info({ agentRole }, 'Self-healing skip — agent role in lastResumeContext.skipAgents');
          await executions.create({
            id: executionId,
            correlationId: plan.correlationId,
            intentId,
            agentRole,
            taskType,
            status: 'skipped',
            tokensUsed: 0,
            durationMs: 0,
            startedAt,
            completedAt: new Date(),
          });
          emitLiveEvent('agent.started', plan.correlationId, {
            executionId, agentRole, taskType, startedAt: startedAt.toISOString(),
          });
          emitLiveEvent('agent.completed', plan.correlationId, {
            executionId, agentRole, status: 'skipped', tokensUsed: 0, durationMs: 0,
            artifactCount: 0, signalCount: 0,
          });
          return;
        }

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

        // The agent instance owns lastPrompt / lastLlmResponse /
        // lastModelUsed after `run()` completes. Hoisted here so the
        // catch block below (the agent's run() threw — rare; usually
        // it returns a `failed` AgentResult instead) can still
        // persist whatever model the failing call routed to.
        let agentInstance: BaseLLMAgent | null = null;
        try {
          const routedSignals = signalsForAgent(agentRole);
          const context = await assembleContext(projectRoot, plan, agentRole, intentText, routedSignals, intentId);
          // ADR-039 — resolve MCP clients for this agent's declared
          // servers. Cached by serverName across the cycle so
          // multiple agents that depend on the same MCP server share
          // one connection.
          const mcpForAgent = resolveMcpForAgent(
            context.agentConfig.tools?.mcp ?? [],
            opts.mcpCache,
            opts.harnessConfig,
            opts.projectCredential,
            childLog,
          );
          const task = {
            taskId: crypto.randomUUID(),
            correlationId: plan.correlationId,
            agentRole,
            contextSnapshot: context,
            maxRetries: 2,
            priorSignals: routedSignals.length ? routedSignals : undefined,
            startedAt: startedAt.getTime(),
            // intent-agent uses these to decide whether to apply the
            // clarification gate, and to fold the operator's
            // clarification text into the prompt on resume. Other
            // agents ignore them.
            intentSource: opts.intentSource,
            clarification:
              agentRole === 'intent-agent' ? opts.clarification : undefined,
            mcpClients: mcpForAgent.length > 0 ? mcpForAgent : undefined,
          };

          // Per-agent LLM routing happens inside BaseLLMAgent.callLLM
          // via `getLLMClientForModel(agentConfig.llm.model)`, which
          // consults the platform LLM registry (migration 014) for
          // per-LLM baseUrl + apiKeyEnv resolution. The agent
          // captures lastModelUsed on its instance after each call;
          // we read it back after `run()` returns to persist into
          // `agent_execution_logs.model_used`.
          agentInstance = newAgentForRole(agentRole);
          // `BaseLLMAgent` is generic over the task / result shapes
          // (TTask, TResult default to `unknown`) so every layer can
          // declare its own typed pair. The generate-layer subclasses
          // return AgentResult — cast at the orchestrator boundary.
          const result = (await agentInstance.run(task)) as AgentResult;

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

          // Persist the execution log row — one per agent_executions
          // row. The IntentDetail accordion in the dashboard reads
          // this back via GET /executions/:id/log. Captures the
          // prompt + LLM response (null for skipped non-LLM agents
          // like lint-config-agent), the result status, the
          // artifacts and signal types produced, and the error
          // message on failure. Don't ride a single bad row into the
          // whole step failing — wrap in `catch` so a missing column
          // or DB blip doesn't break the cycle.
          await executionLogs.save({
            executionId,
            correlationId: plan.correlationId,
            agentRole,
            // Now sourced from the agent instance after `run()` —
            // BaseLLMAgent.callLLM captures these for the LAST LLM
            // call the agent made (covers internal retry loops too).
            // Null for skipped non-LLM agents (lint-config) or
            // pre-LLM failures (intent-agent clarification-needed
            // path triggers BEFORE the agent reaches the LLM is not
            // a thing — clarification fires AFTER, so lastPrompt is
            // populated even there).
            prompt: agentInstance?.lastPrompt ?? null,
            llmResponse: agentInstance?.lastLlmResponse ?? null,
            resultStatus: result.status,
            artifactPaths: (result.artifacts ?? []).map((a) => a.path),
            signalTypes: (result.signals ?? []).map((s) => s.type),
            errorMessage: result.status === 'failed'
              ? (result.signals[0]?.message ?? 'Unknown error')
              : null,
            modelUsed: agentInstance?.lastModelUsed ?? null,
            toolCalls: agentInstance?.lastToolCallLog ?? [],
          }).catch((err) => {
            childLog.warn({ err, executionId, agentRole }, 'executionLogs.save failed');
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

          // ADR-037 / runs_after enforcement — fire dependent custom
          // agents (and their custom→custom chain) for THIS framework
          // step's completion. Failed steps don't get the hook (the
          // cycle is about to bail anyway); skipped steps DO, matching
          // the pre-enforcement behaviour where customs ran after the
          // whole plan finished regardless of which framework steps
          // were skipped.
          if (stepStatus !== 'failed') {
            const dependentCustoms = opts.customAgentsAfter.get(agentRole) ?? [];
            if (dependentCustoms.length > 0) {
              // Build the shared custom-agent context snapshot. We
              // use the post-step plan state via `assembleContext`
              // (so the snapshot's `priorArtifacts` includes every
              // artifact through this framework step), then we
              // override `priorArtifacts` to the FULL set so the
              // custom can see everything the framework produced —
              // matches the pre-enforcement behaviour. context-fixer
              // role coercion stays at the assembleContext boundary.
              const baseCtx = await assembleContext(
                projectRoot, plan, 'code-agent' as AgentRole, intentText, [], intentId,
              );
              const allSoFar = plan.steps.flatMap((s) => s.result?.artifacts ?? []);
              const customCtx = { ...baseCtx, priorArtifacts: allSoFar };
              await runCustomChainFromList(
                dependentCustoms,
                customCtx,
                intentId,
                plan.correlationId,
                opts.customAgentsAfterCustom,
                childLog,
                0,
              );
            }
          }

          // Clarification gate. The intent-agent reports a typed
          // `clarification-needed` status when the cycle can't proceed
          // without operator input. We translate that into:
          //   - intent row transitions to `waiting-for-clarification`
          //   - an Alert row is created (the dashboard's Alerts view
          //     surfaces it; the operator submits the answer through
          //     POST /intents/:id/clarify)
          //   - `alert.created` SSE event so the UI updates without a
          //     refresh
          //   - the plan state flips to `waiting_for_clarification`,
          //     which the outer while-loop checks each iteration to
          //     bail out before any downstream agent runs
          if (
            result.status === 'clarification-needed' &&
            result.clarificationNeeded &&
            agentRole === 'intent-agent'
          ) {
            const { alerts } = getRepositories();
            const created = await alerts.create({
              correlationId: plan.correlationId,
              intentId,
              type: 'clarification-needed',
              severity: 'high',
              title: 'Intent needs clarification',
              description: result.clarificationNeeded.reason,
              requiredAction: 'provide-clarification',
              context: {
                suggestions: result.clarificationNeeded.suggestions,
              },
            });
            emitLiveEvent('alert.created', plan.correlationId, {
              alertId: created.id,
              type: created.type,
              intentId,
              title: created.title,
              severity: created.severity,
            });
            childLog.warn(
              { alertId: created.id, reason: result.clarificationNeeded.reason },
              'Clarification needed — pausing cycle',
            );
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
          // Persist a log row for the throw case too — we may not have
          // the prompt (the agent crashed before returning) but the
          // error message is the operator's only signal.
          await executionLogs.save({
            executionId,
            correlationId: plan.correlationId,
            agentRole,
            prompt: null,
            llmResponse: null,
            resultStatus: 'failed',
            artifactPaths: [],
            signalTypes: [],
            errorMessage: err instanceof Error ? err.message : String(err),
            // The agent threw before completing — the instance's
            // lastModelUsed holds the model from the call that
            // triggered the throw, or null if the throw happened
            // before any LLM call.
            modelUsed: agentInstance?.lastModelUsed ?? null,
            toolCalls: agentInstance?.lastToolCallLog ?? [],
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
 * Constructs the right `BaseLLMAgent` subclass for a given role.
 * The orchestrator instantiates one per step (cheap — these are
 * stateless except for `lastPrompt` / `lastLlmResponse` /
 * `lastModelUsed` which are per-call diagnostics, not persistent
 * agent state).
 */
/**
 * ADR-039 — turns an agent's declared `tools.mcp[]` into a matched
 * array of live `McpClient` instances, using the per-cycle cache to
 * avoid opening the same server twice. The cache survives across
 * agent steps (code-agent + context-agent both declaring `github`
 * share one connection); the orchestrator's `finally` block closes
 * every cached entry once the cycle is over.
 *
 * Token-resolution failures are non-fatal — `resolveMcpClients`
 * returns clients that connect anonymously if the token slot is
 * empty, and `McpClient.listTools()` returns `[]` on connection
 * failure so the LLM proceeds without that server's tools.
 */
function resolveMcpForAgent(
  agentMcpConfigs: import('../types').McpServerConfig[],
  cache: Map<string, McpClient>,
  harnessConfig: HarnessConfig | null,
  projectCredential: string | null,
  childLog: ReturnType<typeof createContextLogger>,
): McpClient[] {
  if (agentMcpConfigs.length === 0) return [];
  const unresolved: import('../types').McpServerConfig[] = [];
  const clients: McpClient[] = [];
  for (const cfg of agentMcpConfigs) {
    const cached = cache.get(cfg.name);
    if (cached) {
      clients.push(cached);
    } else {
      unresolved.push(cfg);
    }
  }
  if (unresolved.length > 0) {
    const newClients = resolveMcpClients(
      unresolved,
      // resolveMcpClients tolerates an empty harness — only the
      // 'harness' token source needs the lookup, and that source is
      // optional per server config.
      (harnessConfig ?? { name: '', description: '', version: '', constraints: { rules: [] }, qualityGate: { maxRetries: 0, signalsToHuman: [] } }) as HarnessConfig,
      projectCredential,
    );
    for (const c of newClients) {
      cache.set(c.serverName, c);
      clients.push(c);
      childLog.debug({ server: c.serverName }, 'MCP client added to cycle cache');
    }
  }
  return clients;
}

function newAgentForRole(agentRole: AgentRole): BaseLLMAgent {
  switch (agentRole) {
    case 'intent-agent':      return new IntentAgent();
    case 'design-agent':      return new DesignAgent();
    case 'context-agent':     return new ContextAgent();
    case 'lint-config-agent': return new LintConfigAgent();
    case 'code-agent':        return new CodeAgent();
    case 'test-agent':        return new TestAgent();
    default:
      throw new Error(`Unknown agent role in generate layer: ${agentRole}`);
  }
}

/**
 * Sentinel error thrown by inline self-healing dispatchers (e.g. the
 * custom-agent failure path) to bail the current cycle early. The
 * generate-orchestrator's catch block recognises it and returns
 * cleanly without re-running self-healing — a retry is already
 * queued and re-running would dispatch a duplicate.
 */
class SelfHealingRetryDispatched extends Error {
  constructor(readonly source: string) {
    super(`Self-healing retry dispatched from ${source}`);
    this.name = 'SelfHealingRetryDispatched';
  }
}

/**
 * Hands a failed cycle to the self-healing loop (migration 020).
 * Loads the intent / signals / artifacts fresh (so it works even
 * when the catch block fired before those were locally captured),
 * runs `runSelfHealingLoop`, and dispatches a retry on success.
 *
 * Returns true when the caller should NOT transition the intent
 * to `failed` — either because the loop dispatched a retry OR the
 * auto-resolver already transitioned to `generating`. Returns
 * false when the caller is responsible for `transitionIntent(..., 'failed')`.
 *
 * NEVER throws — every code path catches and falls through to the
 * caller's failed-transition behaviour.
 */
async function attemptSelfHealingForGenerate(
  intentId: string,
  correlationId: string,
  failureSummary: string,
  technicalDetail: string | undefined,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<{ retryDispatched: boolean }> {
  try {
    const repos = getRepositories();
    const intent = await repos.intents.findById(intentId);
    if (!intent) return { retryDispatched: false };

    const signals = await repos.signals.findByCorrelationId(correlationId);
    const artifacts = await repos.artifacts.findByCorrelationId(correlationId);

    const result = await runSelfHealingLoop(
      {
        intentText: intent.text,
        failureType: 'generate-error',
        failureSummary,
        technicalDetail,
        attemptNumber: (intent.attemptCount ?? 0) + 1,
        priorSignals: signals.map((s) => ({
          type: s.type,
          message: s.message,
          sourceAgent: s.sourceAgent,
          severity: s.severity,
        })),
        priorArtifactPaths: artifacts.map((a) => a.path),
      },
      {
        failureType: 'generate-error',
        correlationId,
        intentId,
        projectId: intent.projectId,
        intentText: intent.text,
        branchName: intent.branchName,
        prNumber: intent.prNumber,
        prUrl: intent.prUrl,
      },
      signals,
    );

    if (result.shouldRetry && !result.escalated && result.diagnosis) {
      // Caller MUST NOT transition to failed — we dispatched a retry.
      await dispatch({
        id: crypto.randomUUID(),
        correlationId,
        type: 'generate:intent',
        sourceAgent: 'self-healing-agent',
        targetAgent: 'intent-agent',
        priority: 'normal',
        payload: {
          intentId,
          projectId: intent.projectId,
          text: result.diagnosis.updatedIntentText ?? intent.text,
          resumeOnBranch: intent.branchName ?? undefined,
          prNumber: intent.prNumber ?? undefined,
          prUrl: intent.prUrl ?? undefined,
          source: 'self-healing',
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }, queueConfigFromEnv());
      // Bring the intent back to `generating` for the retry leg —
      // the worker will pick it up momentarily.
      await transitionIntent(intentId, correlationId, 'generating').catch(() => {});
      childLog.info({ confidence: result.diagnosis.confidence }, 'Self-healing dispatched retry');
      return { retryDispatched: true };
    }

    if (result.escalated && result.autoResolved) {
      // Auto-resolver already transitioned the intent to `generating`
      // and dispatched a fresh cycle. Caller must NOT override.
      childLog.info('Self-healing auto-resolved escalated alert');
      return { retryDispatched: true };
    }

    // Escalated without auto-resolve, or loop disabled: caller
    // transitions to failed. The alert (if any) is already created.
    return { retryDispatched: false };
  } catch (err) {
    childLog.warn({ err }, 'Self-healing loop threw — falling through to failed');
    return { retryDispatched: false };
  }
}

/**
 * Self-healing for custom-agent LLM errors (migration 020 — the
 * `custom-agent-failure` failure type). Same shape as
 * `attemptSelfHealingForGenerate` but with custom-agent context
 * and a different failure summary. Returns `{ retryDispatched }`;
 * the caller throws `SelfHealingRetryDispatched` on `true`.
 *
 * NEVER throws — returns `{ retryDispatched: false }` on any error.
 */
async function attemptSelfHealingForCustomAgent(args: {
  defName: string;
  result: { status: string; summary: string; rawResponse: string; errorMessage?: string };
  intentId: string;
  correlationId: string;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<{ retryDispatched: boolean }> {
  const { defName, result, intentId, correlationId, childLog } = args;
  try {
    const repos = getRepositories();
    const intent = await repos.intents.findById(intentId);
    if (!intent) return { retryDispatched: false };

    const signals = await repos.signals.findByCorrelationId(correlationId);
    const artifacts = await repos.artifacts.findByCorrelationId(correlationId);

    const healing = await runSelfHealingLoop(
      {
        intentText: intent.text,
        failureType: 'custom-agent-failure',
        failureSummary: `Custom agent '${defName}' failed: ${result.errorMessage ?? result.summary}`,
        technicalDetail: result.rawResponse?.slice(0, 500),
        attemptNumber: (intent.attemptCount ?? 0) + 1,
        priorSignals: signals.map((s) => ({
          type: s.type,
          message: s.message,
          sourceAgent: s.sourceAgent,
          severity: s.severity,
        })),
        priorArtifactPaths: artifacts.map((a) => a.path),
      },
      {
        failureType: 'custom-agent-failure',
        correlationId,
        intentId,
        projectId: intent.projectId,
        intentText: intent.text,
        branchName: intent.branchName,
        prNumber: intent.prNumber,
        prUrl: intent.prUrl,
        alertContextExtras: { customAgentName: defName },
      },
      signals,
    );

    if (healing.shouldRetry && !healing.escalated && healing.diagnosis) {
      await dispatch({
        id: crypto.randomUUID(),
        correlationId,
        type: 'generate:intent',
        sourceAgent: 'self-healing-agent',
        targetAgent: 'intent-agent',
        priority: 'normal',
        payload: {
          intentId,
          projectId: intent.projectId,
          text: healing.diagnosis.updatedIntentText ?? intent.text,
          resumeOnBranch: intent.branchName ?? undefined,
          prNumber: intent.prNumber ?? undefined,
          prUrl: intent.prUrl ?? undefined,
          source: 'self-healing',
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }, queueConfigFromEnv());
      await transitionIntent(intentId, correlationId, 'generating').catch(() => {});
      childLog.info({ agentName: defName }, 'Custom-agent self-healing dispatched retry');
      return { retryDispatched: true };
    }

    if (healing.escalated && healing.autoResolved) {
      childLog.info({ agentName: defName }, 'Custom-agent self-healing auto-resolved escalated alert');
      return { retryDispatched: true };
    }
    return { retryDispatched: false };
  } catch (err) {
    childLog.warn({ err, agentName: defName }, 'Custom-agent self-healing loop threw — falling through');
    return { retryDispatched: false };
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

// ─── Custom agents (Step 2 — ADR-037) ────────────────────────────────────────

/**
 * Loads every project-defined custom agent from `agents.yaml` and runs
 * them sequentially against the post-generate artifact set. Each run:
 *   1. creates an `agent_executions` row with `agentRole = def.name`
 *      and `taskType = 'generate:custom'`
 *   2. emits `agent.started` SSE
 *   3. invokes `runCustomAgent(definition, ctx, correlationId)`
 *   4. persists an `agent_execution_logs` row carrying the LLM
 *      response + the captured `modelUsed`
 *   5. saves typed signals for each finding (severity → SignalType)
 *      and emits `signal.emitted` SSE per signal
 *   6. updates the execution row to completed/failed + emits
 *      `agent.completed` SSE
 *
 * Failures (LLM error, parse error) are non-fatal — the runner returns
 * `status: 'error'` and the orchestrator emits a single `CONTEXT_GAP`
 * signal so the gate can see the agent broke. The cycle continues.
 */
/**
 * ADR-037 / runs_after enforcement — executes ONE custom agent
 * against the supplied snapshot. Replaces the prior cycle-level
 * loop: the orchestrator now calls this from inside `drivePlan`
 * immediately after each framework step's dependent customs become
 * eligible, and recursively for any customs that depend on this
 * one.
 *
 * Failures (LLM error, parse error) are non-fatal — emits a single
 * `CONTEXT_GAP` and returns. The gate sees the signal and decides
 * the verdict.
 */
async function runOneCustomAgentNode(
  node: CustomAgentNode,
  ctx: ContextSnapshot,
  intentId: string,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<void> {
  const { executions, signals, executionLogs } = getRepositories();
  const def = node.definition;
  const customAgentRole = def.name as AgentRole;
  const executionId = crypto.randomUUID();
  const startedAt = new Date();

  await executions.create({
    id: executionId,
    correlationId,
    intentId,
    agentRole: customAgentRole,
    taskType: 'generate:custom',
    status: 'running',
    tokensUsed: 0,
    durationMs: null,
    startedAt,
    completedAt: null,
  });
  emitLiveEvent('agent.started', correlationId, {
    executionId,
    agentRole: customAgentRole,
    taskType: 'generate:custom',
    startedAt: startedAt.toISOString(),
  });

  const result = await runCustomAgent(def, ctx, correlationId);

  // The full built prompt isn't stored (it embeds artifact content) —
  // the operator can reconstruct it from the agents.yaml definition
  // + the artifacts on the cycle.
  await executionLogs.save({
    executionId,
    correlationId,
    agentRole: def.name,
    prompt: null,
    llmResponse: result.rawResponse || null,
    resultStatus: result.status,
    artifactPaths: [],
    signalTypes: signalTypesForResult(result),
    errorMessage: result.status === 'error' ? (result.errorMessage ?? result.summary) : null,
    modelUsed: result.modelUsed,
    toolCalls: [],
  }).catch((err) => {
    childLog.warn({ err, executionId, agentRole: def.name }, 'executionLogs.save failed (custom)');
  });

  // Findings → typed signals. Routing per ADR-037:
  //   high   → CONSTRAINT_VIOLATION
  //   medium → LINT_FAILURE
  //   low    → LINT_FAILURE
  //   error  → CONTEXT_GAP (one signal for the whole run)
  const emittedSignals: PlatformSignal[] = [];
  if (result.status === 'error') {
    emittedSignals.push(buildSignal({
      correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      sourceAgent: customAgentRole,
      message: `[${def.name}] ${result.errorMessage ?? result.summary}`,
    }));
  } else {
    for (const finding of result.findings) {
      const type: SignalType =
        finding.severity === 'high' ? 'CONSTRAINT_VIOLATION' : 'LINT_FAILURE';
      const severity: SignalSeverity =
        finding.severity === 'high' ? 'high'
        : finding.severity === 'medium' ? 'medium'
        : 'low';
      emittedSignals.push(buildSignal({
        correlationId,
        type,
        severity,
        sourceAgent: customAgentRole,
        message: `[${def.name}] ${finding.description} (${finding.file})`,
        location: finding.file ? { file: finding.file } : undefined,
      }));
    }
  }
  for (const sig of emittedSignals) {
    await signals.save(sig);
    emitLiveEvent('signal.emitted', correlationId, {
      executionId,
      agentRole: customAgentRole,
      type: sig.type,
      severity: sig.severity,
      sourceAgent: sig.sourceAgent,
      message: sig.message,
    });
  }

  const completedAt = new Date();
  const stepStatus: ExecutionStatus =
    result.status === 'error' ? 'failed'
    : result.passed ? 'completed' : 'failed';

  // Custom-agent self-healing (migration 020). Fires ONLY on a real
  // LLM error (`result.status === 'error'`) — finding-based
  // failures (passed: false but no exception) continue to emit
  // signals that the gate's retry path handles. Throws the
  // `SelfHealingRetryDispatched` sentinel when a retry is queued so
  // the orchestrator can bail the current cycle cleanly.
  if (result.status === 'error') {
    try {
      const healed = await attemptSelfHealingForCustomAgent({
        defName: def.name,
        result,
        intentId,
        correlationId,
        childLog,
      });
      if (healed.retryDispatched) {
        // Finish the execution row so the dashboard's accordion
        // doesn't show a stuck `running` state, then bail.
        await executions.updateStatus(executionId, 'failed', {
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
          startedAt,
          completedAt,
        }).catch(() => {});
        throw new SelfHealingRetryDispatched(`custom-agent:${def.name}`);
      }
    } catch (err) {
      if (err instanceof SelfHealingRetryDispatched) throw err;
      childLog.warn({ err, agentName: def.name }, 'Custom-agent self-healing threw — continuing existing flow');
    }
  }

  await executions.updateStatus(executionId, stepStatus, {
    tokensUsed: result.tokensUsed,
    durationMs: result.durationMs,
    startedAt,
    completedAt,
  });
  emitLiveEvent('agent.completed', correlationId, {
    executionId,
    agentRole: customAgentRole,
    status: stepStatus,
    tokensUsed: result.tokensUsed,
    durationMs: result.durationMs,
    artifactCount: 0,
    signalCount: emittedSignals.length,
  });

  childLog.info({
    agentName: def.name,
    runsAfter: node.dependsOn,
    status: result.status,
    passed: result.passed,
    findingCount: result.findings.length,
    signalCount: emittedSignals.length,
    durationMs: result.durationMs,
    modelUsed: result.modelUsed,
  }, 'Custom agent completed');
}

/**
 * Cap on recursive `customA → customB → customC → ...` chain depth.
 * Cycle detection in `scheduleCustomAgents` rejects circular graphs
 * at startup, but a pathological long-chain config (50 custom agents
 * each depending on the previous) would still walk fine — the depth
 * limit is a runaway-recursion guard, not a correctness fence.
 */
const MAX_CUSTOM_AGENT_CHAIN_DEPTH = 20;

/**
 * Runs every custom agent in `customNodes` in order, and after each
 * one completes, recurses into customs that declared `runs_after:
 * <thatCustomName>`. Used by the per-step branch of drivePlan to
 * walk the chain `framework → custom → custom → ...` without
 * re-implementing the recursion at every call site.
 */
async function runCustomChainFromList(
  customNodes: CustomAgentNode[],
  ctx: ContextSnapshot,
  intentId: string,
  correlationId: string,
  customAgentsAfterCustom: Map<string, CustomAgentNode[]>,
  childLog: ReturnType<typeof createContextLogger>,
  depth: number,
): Promise<void> {
  if (customNodes.length === 0) return;
  if (depth > MAX_CUSTOM_AGENT_CHAIN_DEPTH) {
    childLog.warn(
      { depth, count: customNodes.length },
      'Custom agent chain exceeded MAX_CUSTOM_AGENT_CHAIN_DEPTH — stopping',
    );
    return;
  }
  for (const node of customNodes) {
    await runOneCustomAgentNode(node, ctx, intentId, correlationId, childLog);
    const next = customAgentsAfterCustom.get(node.definition.name) ?? [];
    await runCustomChainFromList(
      next, ctx, intentId, correlationId, customAgentsAfterCustom, childLog, depth + 1,
    );
  }
}

function signalTypesForResult(result: { status: string; findings: Array<{ severity: string }> }): SignalType[] {
  if (result.status === 'error') return ['CONTEXT_GAP'];
  return result.findings.map((f) =>
    f.severity === 'high' ? 'CONSTRAINT_VIOLATION' : 'LINT_FAILURE',
  );
}

function buildSignal(args: {
  correlationId: string;
  type: SignalType;
  severity: SignalSeverity;
  sourceAgent: AgentRole;
  message: string;
  location?: { file: string; line?: number };
}): PlatformSignal {
  return {
    id: crypto.randomUUID(),
    correlationId: args.correlationId,
    type: args.type,
    severity: args.severity,
    sourceAgent: args.sourceAgent,
    message: args.message,
    ...(args.location ? { location: args.location } : {}),
    autoResolvable: args.type !== 'GOLDEN_PRINCIPLE_BREACH',
    createdAt: new Date(),
  };
}
