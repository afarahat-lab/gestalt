/**
 * Quality-gate orchestrator — BullMQ worker.
 *
 * Drains `bull:gestalt-gate:*`. Consumes the `gate:review` task the
 * generate-orchestrator dispatches at the end of a successful generate
 * cycle. For each task the orchestrator:
 *
 *   1. Looks up the project and clones the repo into a fresh temp dir
 *      (mirrors the generate orchestrator). The clone is at the Git tip
 *      the generate cycle just pushed.
 *   2. Builds a GateTask with the artifacts the generate orchestrator
 *      sent over the queue + a default GateHarnessConfig.
 *   3. Runs constraint-agent and llm-review-agent in parallel. Each is
 *      wrapped with `agent_executions` create/update + SSE events
 *      (`agent.started`, `agent.completed`, `signal.emitted`).
 *   4. Persists each signal via `signals.save` and any artifacts the
 *      review-agent produced (a markdown review of the artifact set).
 *   5. Synthesises a GateResult (`synthesiseGateResult`) → verdict.
 *   6. Transitions the intent:
 *        - `pass`     → `approved`
 *        - `fail`     → `failed`     (no feedback-loop-back-to-generate yet)
 *        - `escalate` → `escalated`  (GOLDEN_PRINCIPLE_BREACH)
 *      The transition is broadcast on the in-process event bus.
 *   7. Emits a `gate.completed` event with the verdict + signal count.
 *
 * The temp clone is removed in a `finally` block on every code path.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  createWorker, dispatch, getRepositories,
  createContextLogger, emitLiveEvent, QUEUE_NAMES,
  BaseOrchestrator,
  runSelfHealingLoop,
  resolveProjectCredential,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, TaskPriority, QueueConfig,
  Artifact, PlatformSignal, ExecutionStatus, IntentStatus,
} from '@gestalt/core';
import { runConstraintAgent } from '../agents/constraint-agent';
import { ReviewAgent } from '../agents/llm-review-agent';
import { synthesiseGateResult, summariseGateResult } from '../agents/review-agent';
import type {
  GateAgentResult, GateAgentRole, GateHarnessConfig, GateResult, GateSignal, GateTask, ArtifactRef,
} from '../types';

/**
 * Maximum number of gate retries before the orchestrator gives up and
 * marks the intent `failed`. Mirrors the constant of the same name in
 * the generate-orchestrator. A future iteration reads this from the
 * project's HARNESS.json quality-gate config.
 */
const MAX_GATE_RETRIES = 3;

const log = createContextLogger({ module: 'gate-orchestrator' });

interface GateTaskPayload {
  intentId: string;
  artifacts: Array<{
    id: string;
    correlationId?: string;
    type: string;
    path: string;
    content: string;
    producedBy?: string;
    createdAt?: string | Date;
  }>;
  /**
   * Retry context forwarded by the generate orchestrator. `retryCount` is
   * the count of cycles already consumed; the gate increments it when it
   * dispatches its own follow-up. `projectId` + `text` are forwarded so
   * the gate can dispatch a complete `generate:intent` payload back to
   * the generate queue on a `fail` verdict.
   */
  retryCount?: number;
  projectId?: string;
  text?: string;
  /**
   * Pipeline-feedback resume — forwarded from the generate orchestrator
   * so this gate dispatch can carry it through to `deploy:pr`. pr-agent
   * then pushes to the same branch instead of opening a new PR.
   */
  resumeOnBranch?: string;
  prNumber?: number;
  prUrl?: string;
}

/**
 * Subset of generate's intent-task payload. Mirrors the contract in
 * `packages/agents/generate/src/orchestrator/orchestrator.ts` so this
 * file does not depend on agents-generate at compile time.
 */
interface GenerateRetryPayload {
  intentId: string;
  text: string;
  projectId: string;
  retryCount: number;
  priorSignals: Array<{
    id: string;
    correlationId: string;
    type: string;
    severity: string;
    sourceAgent: string;
    message: string;
    location?: { file: string; line?: number; column?: number; rule?: string };
    autoResolvable: boolean;
    createdAt: Date | string;
  }>;
}

/**
 * Embed a Git PAT into an HTTPS clone URL. Mirrors the helper in
 * generate's orchestrator (same shape, same auth contract).
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

/**
 * Set the intent's status, persist it, and broadcast the transition
 * over the in-process event bus.
 */
async function transitionIntent(
  intentId: string,
  correlationId: string,
  status: IntentStatus,
): Promise<void> {
  const { intents } = getRepositories();
  await intents.updateStatus(intentId, status);
  emitLiveEvent('intent.status-changed', correlationId, { intentId, status });
}

/**
 * Looks up the project for this correlationId via the intents table so
 * the gate worker can resolve the gitUrl + PAT without the generate
 * orchestrator having to redundantly thread projectId on the queue.
 */
async function resolveProjectFor(intentId: string): Promise<{
  gitUrl: string;
  defaultBranch: string;
  token: string;
} | null> {
  const { intents, projects } = getRepositories();
  const intent = await intents.findById(intentId);
  if (!intent) return null;
  const project = await projects.findById(intent.projectId);
  if (!project) return null;
  const token = await resolveProjectCredential(project);
  if (!token) return null;
  return { gitUrl: project.gitUrl, defaultBranch: project.defaultBranch, token };
}

/**
 * Default GateHarnessConfig used when no project-specific config exists.
 * Future iterations should read this from the project's HARNESS.json.
 */
function defaultGateHarnessConfig(projectRoot: string): GateHarnessConfig {
  return {
    projectRoot,
    constraintRules: [],
    goldenPrinciples: [
      'GP-001: Every state-changing operation produces an audit record',
      'GP-002: RBAC enforced at middleware, never inline',
      'GP-003: Input validated at the API boundary',
      'GP-004: No sensitive data in logs',
    ],
    qualityGate: {
      maxRetries: 3,
      blockingSignals: ['GOLDEN_PRINCIPLE_BREACH', 'CONSTRAINT_VIOLATION'],
    },
  };
}

/**
 * Quality-gate orchestrator (Amendment 2026-06 — `extends
 * BaseOrchestrator` for the structural goal of every orchestrator
 * sharing one base. The review-agent now uses `callLLMWithTools`
 * with the per-role default readFile + searchFiles set so it can
 * verify findings against actual file content; the change is on
 * the agent itself, not on the orchestrator's drive loop).
 */
export class GateOrchestrator extends BaseOrchestrator {
  constructor() { super('gate-orchestrator'); }
}

export function startGateWorker(queueConfig: QueueConfig): void {
  // Instantiate the class for future use of shared services. The
  // existing handleGateTask function continues to drive the worker.
  new GateOrchestrator();
  createWorker<GateTaskPayload>(
    QUEUE_NAMES.gate,
    handleGateTask,
    queueConfig,
    { concurrency: 2 },
  );
  log.info('Quality-gate worker started');
}

async function handleGateTask(message: TaskMessage<GateTaskPayload>): Promise<TaskResult> {
  const { correlationId } = message;
  const payload = message.payload;
  const childLog = createContextLogger({ module: 'gate-orchestrator', correlationId });
  const startedAt = new Date();

  childLog.info({ intentId: payload.intentId }, 'Quality gate received task');

  let workDir: string | null = null;
  try {
    const project = await resolveProjectFor(payload.intentId);
    if (!project) {
      throw new Error(`Cannot resolve project for intent ${payload.intentId}`);
    }

    workDir = await mkdtemp(join(tmpdir(), `gestalt-gate-${correlationId}-`));
    const cloneUrl = authenticatedGitUrl(project.gitUrl, project.token);
    childLog.info({ workDir }, 'Cloning project repo for gate review');
    await simpleGit().clone(cloneUrl, workDir);

    // Resolve the operator's intent text. The payload usually carries
    // it on a retry leg; on a first dispatch we fall back to the
    // persisted intent row. The review-agent uses this for scaffolding
    // detection — absent text falls through to a normal review.
    let intentText: string | undefined = payload.text;
    if (!intentText) {
      const intentRow = await getRepositories().intents.findById(payload.intentId);
      intentText = intentRow?.text ?? undefined;
    }

    const gateTask: GateTask = {
      taskId: message.id,
      correlationId,
      artifacts: payload.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        content: a.content,
      })) as ArtifactRef[],
      harnessConfig: defaultGateHarnessConfig(workDir),
      intentText,
    };

    // BaseLLMAgent now owns LLM-call routing + lastModelUsed capture.
    // ReviewAgent.review(task) uses this.callLLM internally; we read
    // back `agent.lastPrompt` / `agent.lastLlmResponse` /
    // `agent.lastModelUsed` after the call to thread them into the
    // observability wrapper's execution-log persistence.
    const reviewAgent = new ReviewAgent();

    // Run constraint + review in parallel. Each step persists its own
    // agent_executions row and emits its own SSE events; concurrency is
    // safe because each owns its own DB rows.
    const [constraintRes, reviewRes] = await Promise.all([
      runWithObservability(
        'constraint-agent',
        'gate:constraint',
        correlationId,
        payload.intentId,
        () => runConstraintAgent(gateTask),
        childLog,
      ),
      runWithObservability(
        'review-agent',
        'gate:review',
        correlationId,
        payload.intentId,
        async () => {
          const r = await reviewAgent.review(gateTask);
          // Side-effect: persist the markdown review artifact so the
          // operator can read the prose feedback alongside the signals.
          if (r.reviewArtifact) {
            const { artifacts } = getRepositories();
            await artifacts.save(r.reviewArtifact as unknown as Artifact);
          }
          // Forward the instance-captured prompt / response / model
          // to the observability wrapper. These were on the
          // `runLlmReviewAgent` result before the BaseLLMAgent
          // refactor; now they're on the agent instance.
          if (reviewAgent.lastPrompt) r.lastPrompt = reviewAgent.lastPrompt;
          if (reviewAgent.lastLlmResponse) r.llmResponse = reviewAgent.lastLlmResponse;
          if (reviewAgent.lastModelUsed) r.modelUsed = reviewAgent.lastModelUsed;
          // Fix D — surface the BaseLLMAgent's accumulated token
          // count so `agent_executions.tokens_used` is non-zero for
          // the review-agent row.
          if (reviewAgent.lastTokensUsed > 0) {
            (r as unknown as { tokensUsed?: number }).tokensUsed = reviewAgent.lastTokensUsed;
          }
          return r;
        },
        childLog,
      ),
    ]);

    const result = synthesiseGateResult(
      correlationId,
      [constraintRes, reviewRes],
      startedAt,
    );

    childLog.info(
      { verdict: result.verdict, signalCount: result.signals.length },
      summariseGateResult(result),
    );

    emitLiveEvent('gate.completed', correlationId, {
      intentId: payload.intentId,
      verdict: result.verdict,
      signalCount: result.signals.length,
      agentResults: result.agentResults.map((a) => ({
        agentRole: a.agentRole,
        status: a.status,
        signalCount: a.signals.length,
        durationMs: a.durationMs,
      })),
      summary: summariseGateResult(result),
    });

    // Verdict dispatch:
    //   pass     → intent becomes `approved`; dispatch `deploy:pr` to the
    //              deploy orchestrator (pr-agent flips it to `deploying`
    //              when it starts work)
    //   escalate → intent becomes `escalated` (GP_BREACH, human review)
    //   fail     → either dispatch a retry to the generate queue, or
    //              transition to `failed` if max retries exhausted /
    //              no signal is auto-resolvable
    if (result.verdict === 'pass') {
      await transitionIntent(payload.intentId, correlationId, 'approved');
      await dispatchDeployPR({
        message,
        payload,
        childLog,
      });
    } else if (result.verdict === 'escalate') {
      await transitionIntent(payload.intentId, correlationId, 'escalated');
      // Surface the breach to the dashboard's Alerts view. Without
      // this the intent transitions to `escalated` but the operator
      // sees no actionable item — they have to discover the
      // escalation by polling the intent list. The
      // `POST /interventions` route's open-alert lookup degrades
      // gracefully when the alert is missing, but the dashboard's
      // Alerts page only renders rows from the `alerts` table.
      await createBreachAlert({
        correlationId,
        intentId: payload.intentId,
        gateSignals: result.signals,
        childLog,
      });
    } else {
      const retried = await maybeDispatchRetry({
        message,
        payload,
        gateResult: result,
        childLog,
      });
      if (!retried) {
        // Gate retry budget exhausted — hand off to self-healing
        // (migration 020) before marking the intent failed. If
        // self-healing dispatches a fresh cycle the intent stays in
        // `generating`; otherwise it transitions to `failed` and the
        // escalation alert (if any) carries the human-attention
        // signal.
        const healing = await attemptSelfHealingForGate({
          intentId: payload.intentId,
          correlationId,
          gateResult: result,
          childLog,
        });
        if (!healing.retryDispatched) {
          await transitionIntent(payload.intentId, correlationId, 'failed');
        }
      }
    }

    return {
      taskId: message.id,
      correlationId,
      agentRole: 'review-agent',
      status: result.verdict === 'pass' ? 'completed' : 'failed',
      output: {
        verdict: result.verdict,
        signalCount: result.signals.length,
        summary: summariseGateResult(result),
      },
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt.getTime(),
      completedAt: new Date(),
    };
  } catch (err) {
    childLog.error({ err }, 'Quality-gate orchestrator error');
    await transitionIntent(payload.intentId, correlationId, 'failed').catch(() => undefined);
    throw err;
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Wraps a gate-agent run with the same DB + SSE observability pattern the
 * generate orchestrator uses: creates the `agent_executions` row, runs
 * the agent, persists its signals, updates the row to a terminal status,
 * and emits `agent.started` / `agent.completed` / `signal.emitted` along
 * the way.
 */
async function runWithObservability<T extends GateAgentResult>(
  agentRole: GateAgentRole,
  taskType: string,
  correlationId: string,
  intentId: string,
  invoke: () => Promise<T>,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<T> {
  const { executions, signals, executionLogs } = getRepositories();
  const executionId = crypto.randomUUID();
  const startedAt = new Date();

  await executions.create({
    id: executionId,
    correlationId,
    intentId,
    agentRole,
    taskType,
    status: 'running',
    tokensUsed: 0,
    durationMs: null,
    startedAt,
    completedAt: null,
  });
  emitLiveEvent('agent.started', correlationId, {
    executionId,
    agentRole,
    taskType,
    startedAt: startedAt.toISOString(),
  });

  let result: T;
  try {
    result = await invoke();
  } catch (err) {
    childLog.error({ err, agentRole }, 'Gate agent threw');
    const completedAt = new Date();
    await executions.updateStatus(executionId, 'failed', {
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt,
      completedAt,
    }).catch(() => undefined);
    await executionLogs.save({
      executionId,
      correlationId,
      agentRole,
      prompt: null,
      llmResponse: null,
      resultStatus: 'failed',
      artifactPaths: [],
      signalTypes: [],
      errorMessage: err instanceof Error ? err.message : String(err),
      modelUsed: null,
      toolCalls: [],
    }).catch(() => undefined);
    emitLiveEvent('agent.completed', correlationId, {
      executionId,
      agentRole,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    // Re-shape the failure into a GateAgentResult so callers can keep
    // synthesising a verdict.
    return {
      agentRole,
      status: 'errored',
      signals: [],
      durationMs: completedAt.getTime() - startedAt.getTime(),
    } as unknown as T;
  }

  for (const sig of result.signals) {
    await signals.save(gateSignalToPlatformSignal(sig));
    emitLiveEvent('signal.emitted', correlationId, {
      executionId,
      agentRole,
      type: sig.type,
      severity: sig.severity,
      sourceAgent: sig.agentRole,
      message: sig.message,
    });
  }

  const completedAt = new Date();
  const stepStatus: ExecutionStatus = result.status === 'errored'
    ? 'failed' : result.status === 'failed' ? 'failed' : 'completed';
  // Fix D — review-agent now reports its accumulated token count
  // through the `tokensUsed` field; constraint-agent is non-LLM and
  // leaves it undefined → falls back to 0.
  const tokensUsed = ((result as unknown as { tokensUsed?: number }).tokensUsed) ?? 0;
  await executions.updateStatus(executionId, stepStatus, {
    tokensUsed,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    startedAt,
    completedAt,
  });

  // Persist the execution log row. The result type widens to allow the
  // optional `lastPrompt` + `llmResponse` + `modelUsed` (added to
  // `GateAgentResult` for LLM-backed gate agents like review-agent;
  // non-LLM agents like constraint-agent leave them undefined and the
  // columns go null).
  const resultWithPrompt = result as unknown as GateAgentResult & {
    lastPrompt?: string;
    llmResponse?: string;
    modelUsed?: string;
  };
  await executionLogs.save({
    executionId,
    correlationId,
    agentRole,
    prompt: resultWithPrompt.lastPrompt ?? null,
    llmResponse: resultWithPrompt.llmResponse ?? null,
    resultStatus: result.status,
    artifactPaths: [],   // gate agents do not produce artifacts
    signalTypes: result.signals.map((s) => s.type),
    modelUsed: resultWithPrompt.modelUsed ?? null,
    errorMessage: result.status === 'errored'
      ? 'Gate agent threw before producing a structured response'
      : null,
    toolCalls: [],
  }).catch((err) => {
    childLog.warn({ err, executionId, agentRole }, 'executionLogs.save failed');
  });

  emitLiveEvent('agent.completed', correlationId, {
    executionId,
    agentRole,
    status: stepStatus,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    signalCount: result.signals.length,
  });

  return result;
}

/**
 * Convert the gate-layer `GateSignal` shape to the platform-wide
 * `PlatformSignal` shape (drop `agentRole`, rename to `sourceAgent`,
 * ensure `createdAt`).
 */
function gateSignalToPlatformSignal(s: GateSignal): PlatformSignal {
  const out: PlatformSignal = {
    id: s.id,
    correlationId: s.correlationId,
    type: s.type,
    severity: s.severity,
    sourceAgent: s.agentRole,
    message: s.message,
    autoResolvable: s.autoResolvable,
    createdAt: new Date(),
  };
  if (s.location) out.location = s.location;
  return out;
}

/**
 * On a `pass` verdict, dispatch `deploy:pr` to the deploy orchestrator so
 * pr-agent can open the PR and the deploy chain can proceed. The intent
 * has already been transitioned to `approved`; pr-agent flips it to
 * `deploying` when it picks up the task.
 *
 * If `projectId` / `intentText` / `artifacts` cannot be reconstructed
 * (older-shape gate task), the deploy step is skipped — intent stays at
 * `approved` and the operator can re-run the cycle.
 */
async function dispatchDeployPR(args: {
  message: TaskMessage<GateTaskPayload>;
  payload: GateTaskPayload;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<void> {
  const { message, payload, childLog } = args;
  const correlationId = message.correlationId;

  const projectId = payload.projectId
    ?? (await getRepositories().intents.findById(payload.intentId))?.projectId;
  const intentText = payload.text
    ?? (await getRepositories().intents.findById(payload.intentId))?.text;
  if (!projectId || !intentText) {
    childLog.warn('Gate pass — cannot reconstruct deploy payload; skipping deploy:pr');
    return;
  }
  if (!payload.artifacts || payload.artifacts.length === 0) {
    childLog.info('Gate pass — no artifacts in payload; skipping deploy:pr');
    return;
  }

  await dispatch({
    id: crypto.randomUUID(),
    correlationId,
    type: 'deploy:pr',
    sourceAgent: 'review-agent',
    targetAgent: 'pr-agent',
    priority: (message.priority ?? 'normal') as TaskPriority,
    payload: {
      intentId: payload.intentId,
      projectId,
      intentText,
      artifacts: payload.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        content: a.content,
      })),
      // Pipeline-feedback resume — forwarded so pr-agent pushes to
      // the existing branch + reuses the open PR instead of opening
      // a new one. All three optional; undefined → normal flow.
      resumeOnBranch: payload.resumeOnBranch,
      prNumber: payload.prNumber,
      prUrl: payload.prUrl,
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }, queueConfigFromEnv());

  childLog.info(
    { intentId: payload.intentId, artifactCount: payload.artifacts.length },
    'Gate pass — dispatched deploy:pr',
  );
}

/**
 * On a `fail` verdict, decide whether to dispatch a retry cycle back to
 * the generate orchestrator (feedback loop) or to bail out.
 *
 * Returns true when a retry was dispatched. The caller skips the intent
 * transition in that case — the retry leg will be the one to make a final
 * call. Returns false otherwise; caller falls back to `failed`.
 *
 * Three reasons to NOT retry:
 *   1. The retry budget has been exhausted (`retryCount >= MAX_GATE_RETRIES`)
 *   2. None of the signals are auto-resolvable — re-running won't help
 *   3. We cannot resolve enough payload context (intent text / projectId)
 *      to build a valid generate task
 */
/**
 * Creates a `GOLDEN_PRINCIPLE_BREACH` alert when the gate escalates.
 *
 * Without this row, the intent transitions to `escalated` but the
 * dashboard's Alerts view shows nothing — operators have to discover
 * the escalation by polling the intent list. The alert ties the
 * breach to its source signals via `context.breachSignalIds` so the
 * dashboard's `enrichAlert` pass can resurface
 * `breachMessage` / `breachLocation` / `breachAgent` without
 * additional plumbing (it already looks up signals by correlation).
 *
 * Failure is non-fatal — the intent is already escalated, so a
 * missed alert is worse UX but not data loss. We log + continue.
 */
/**
 * Hands a max-retries-exhausted gate cycle to the self-healing loop
 * (migration 020). Same shape as the generate orchestrator's
 * `attemptSelfHealingForGenerate`: returns `{ retryDispatched }`,
 * the caller transitions to `failed` only when false.
 *
 * NEVER throws — falls back to false on any error.
 */
async function attemptSelfHealingForGate(args: {
  intentId: string;
  correlationId: string;
  gateResult: GateResult;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<{ retryDispatched: boolean }> {
  const { intentId, correlationId, gateResult, childLog } = args;
  try {
    const repos = getRepositories();
    const intent = await repos.intents.findById(intentId);
    if (!intent) return { retryDispatched: false };

    const signals = await repos.signals.findByCorrelationId(correlationId);
    const artifacts = await repos.artifacts.findByCorrelationId(correlationId);

    const result = await runSelfHealingLoop(
      {
        intentText: intent.text,
        failureType: 'gate-max-retries',
        failureSummary: `Quality gate exhausted retry budget — ${gateResult.signals.length} signal(s) remain`,
        technicalDetail: summariseGateResult(gateResult).slice(0, 500),
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
        failureType: 'gate-max-retries',
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

    // Option B (migration 020 amendment): loop owns dispatch +
    // transitionIntent. The dispatched queue may be
    // generate:intent (code fix), deploy:pr (push retry), etc. —
    // whatever the diagnostician chose.
    if (result.shouldRetry && !result.escalated && result.diagnosis) {
      childLog.info(
        {
          retryTaskType: result.diagnosis.retryTaskType,
          confidence: result.diagnosis.confidence,
          hintKeys: Object.keys(result.diagnosis.retryPayloadHints ?? {}),
        },
        'Gate self-healing dispatched retry (loop)',
      );
      return { retryDispatched: true };
    }

    if (result.escalated && result.autoResolved) {
      childLog.info('Gate self-healing auto-resolved escalated alert');
      return { retryDispatched: true };
    }
    return { retryDispatched: false };
  } catch (err) {
    childLog.warn({ err }, 'Gate self-healing loop threw — falling through to failed');
    return { retryDispatched: false };
  }
}

async function createBreachAlert(args: {
  correlationId: string;
  intentId: string;
  gateSignals: GateSignal[];
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<void> {
  const { correlationId, intentId, gateSignals, childLog } = args;
  const breachSignals = gateSignals.filter(
    (s) => s.type === 'GOLDEN_PRINCIPLE_BREACH',
  );
  // Defensive — the caller only invokes us on `verdict === 'escalate'`
  // which by construction includes at least one GP_BREACH, but a
  // future verdict reshape shouldn't crash the gate.
  if (breachSignals.length === 0) {
    childLog.warn('createBreachAlert called without any GP_BREACH signals — skipping');
    return;
  }
  const primary = breachSignals[0]!;
  const description = breachSignals.length === 1
    ? primary.message
    : `${breachSignals.length} golden-principle breach(es) require review. First: ${primary.message}`;
  try {
    const { alerts } = getRepositories();
    const alert = await alerts.create({
      correlationId,
      intentId,
      type: 'GOLDEN_PRINCIPLE_BREACH',
      severity: 'critical',
      title: 'Quality gate escalated — golden-principle breach',
      description,
      requiredAction: 'acknowledge-breach',
      context: {
        intentId,
        breachSignalIds: breachSignals.map((s) => s.id),
        breachAgent: primary.agentRole,
        triggeredBy: 'gate-escalate',
      },
    });
    emitLiveEvent('alert.created', correlationId, {
      alertId: alert.id,
      type: 'GOLDEN_PRINCIPLE_BREACH',
      intentId,
      severity: 'critical',
    });
    childLog.info(
      { alertId: alert.id, breachCount: breachSignals.length },
      'GP_BREACH alert created for escalated intent',
    );
  } catch (err) {
    childLog.warn(
      { err, intentId, breachCount: breachSignals.length },
      'createBreachAlert failed — intent stays escalated but alert is missing',
    );
  }
}

async function maybeDispatchRetry(args: {
  message: TaskMessage<GateTaskPayload>;
  payload: GateTaskPayload;
  gateResult: GateResult;
  childLog: ReturnType<typeof createContextLogger>;
}): Promise<boolean> {
  const { message, payload, gateResult, childLog } = args;
  const correlationId = message.correlationId;

  const retryCount = payload.retryCount ?? 0;
  const nextRetryCount = retryCount + 1;

  const retryableSignals = gateResult.signals.filter((s) => s.autoResolvable);

  if (retryCount >= MAX_GATE_RETRIES) {
    childLog.warn(
      { retryCount, max: MAX_GATE_RETRIES },
      'Gate fail — retry budget exhausted',
    );
    return false;
  }
  if (retryableSignals.length === 0) {
    childLog.warn('Gate fail — no auto-resolvable signals; cannot retry');
    return false;
  }

  const projectId = payload.projectId
    ?? (await getRepositories().intents.findById(payload.intentId))?.projectId;
  const intentText = payload.text
    ?? (await getRepositories().intents.findById(payload.intentId))?.text;
  if (!projectId || !intentText) {
    childLog.warn('Gate fail — cannot reconstruct generate payload for retry');
    return false;
  }

  // Transition the intent back to `generating` so dashboards reflect the
  // retry leg immediately. The next generate cycle will re-set it later.
  await transitionIntent(payload.intentId, correlationId, 'generating');

  const retryPayload: GenerateRetryPayload = {
    intentId: payload.intentId,
    text: intentText,
    projectId,
    retryCount: nextRetryCount,
    priorSignals: retryableSignals.map((s) => ({
      id: s.id,
      correlationId: s.correlationId,
      type: s.type,
      severity: s.severity,
      sourceAgent: s.agentRole,
      message: s.message,
      ...(s.location ? { location: s.location } : {}),
      autoResolvable: s.autoResolvable,
      createdAt: new Date(),
    })),
  };

  await dispatch({
    id: crypto.randomUUID(),
    correlationId,
    type: 'generate:intent',
    sourceAgent: 'review-agent',
    targetAgent: 'orchestrator',
    priority: (message.priority ?? 'normal') as TaskPriority,
    payload: retryPayload,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }, queueConfigFromEnv());

  emitLiveEvent('intent.status-changed', correlationId, {
    intentId: payload.intentId,
    status: 'generating',
    note: `gate-retry ${nextRetryCount}/${MAX_GATE_RETRIES} — ${retryableSignals.length} signal(s) routed`,
  });

  childLog.info(
    {
      retryCount: nextRetryCount,
      max: MAX_GATE_RETRIES,
      signalCount: retryableSignals.length,
    },
    'Gate fail — dispatched retry to generate queue',
  );

  return true;
}

function queueConfigFromEnv(): QueueConfig {
  return { redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };
}
