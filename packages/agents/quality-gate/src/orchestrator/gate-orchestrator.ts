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

import { mkdtemp, rm, readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
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
import { runConstraintAgent, getConstraintAgentInstance } from '../agents/constraint-agent';
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

/**
 * TR_020 — absolute safety net. Even if `retryCount` threading
 * regresses again (TR_019 ran 46 rounds because the deploy chain
 * dropped retryCount), this hard cap ensures the gate never spins
 * past 5 cycles regardless of payload contents. Checked BEFORE the
 * primary `MAX_GATE_RETRIES` check uses payload.retryCount, so a
 * broken upstream that resets the counter to 0 still escalates here.
 * The intent's `attemptCount` column is the source of truth for
 * "how many cycles has this intent actually consumed", populated
 * exclusively by self-healing-loop's `incrementAttemptCount` AND now
 * by `maybeDispatchRetry` on every dispatch.
 */
const ABSOLUTE_MAX_RETRIES = 5;

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
   * ADR-041 post-CI gate mode. When `true` the gate-orchestrator loads
   * source files from the cloned PR branch (the exact code that just
   * passed CI) instead of the artifacts that were carried over the
   * queue. On `false` (or absent) the gate falls back to the legacy
   * pre-CI artifact-based path — preserved for backward compatibility
   * with in-flight jobs queued before this change.
   */
  readFromBranch?: boolean;
  /**
   * The PR branch the cycle landed on. Set whenever the gate is being
   * dispatched after a PR has been opened — by deploy-orchestrator on
   * CI-success (ADR-041) and by the gate's own retry path on a fail
   * verdict (so generate's resume leg pushes back to the same branch).
   */
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  /**
   * GitHub Actions run id (or whichever CI provider) for the run that
   * just passed. Forwarded into the gate's promotion dispatch only so
   * the deployment events table can link gate → CI run.
   */
  ciRunId?: string;
  /**
   * Legacy pre-push field — pipeline-feedback resume. Preserved for the
   * older pre-CI artifact-based gate path. New CI-success dispatches
   * set `branch` instead.
   */
  resumeOnBranch?: string;
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
 * Reads `HARNESS.json` from the cloned project root and returns its
 * `stack` block (TEST_REPORT_002 Fix 3b). Returns `undefined` for any
 * failure (missing file, bad JSON, no stack key) so the caller can
 * fall through to the default. Used to thread `stack.testFramework`
 * into the constraint-agent's dynamic rule set without each agent
 * having to re-implement the file read.
 */
async function loadHarnessStack(projectRoot: string): Promise<GateHarnessConfig['stack'] | undefined> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as { stack?: Record<string, string> };
    if (!parsed.stack || typeof parsed.stack !== 'object') return undefined;
    return {
      testFramework: typeof parsed.stack['testFramework'] === 'string' ? parsed.stack['testFramework'] : undefined,
      language: typeof parsed.stack['language'] === 'string' ? parsed.stack['language'] : undefined,
      framework: typeof parsed.stack['framework'] === 'string' ? parsed.stack['framework'] : undefined,
      packageManager: typeof parsed.stack['packageManager'] === 'string' ? parsed.stack['packageManager'] : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * TR_027 / ADR-051 — true when the project has opted into PR-Agent
 * AND the pipeline adapter supports the integration. In that case
 * the gate skips its own LLM review-agent step (PR-Agent has
 * already posted its review and pipeline-agent has already routed
 * `changes-requested` through self-healing).
 */
async function shouldSkipReviewAgent(projectRoot: string): Promise<boolean> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      pipeline?: { adapter?: string };
      prAgent?: { enabled?: boolean };
    };
    return parsed.prAgent?.enabled === true && parsed.pipeline?.adapter === 'github-actions';
  } catch {
    return false;
  }
}

/**
 * ADR-041 — file extensions the gate considers "source code" when
 * loading the post-CI artifact set from the PR branch. Languages the
 * platform supports today; new languages should be added here when
 * their support lands. Test files (e.g. `*.test.ts`) are included on
 * purpose — review-agent reviews tests too.
 */
const SOURCE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.rs', '.cs', '.rb', '.kt', '.swift',
]);

/**
 * Directories that never carry source code worth reviewing. Skipped
 * during the recursive walk to avoid pulling in dependency trees
 * (node_modules) or build output (dist, build, target).
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.gestalt', 'dist', 'build', 'target',
  '.next', '.nuxt', 'out', 'coverage', '__pycache__', '.venv', 'venv',
  '.pytest_cache', '.mypy_cache',
]);

/** Cap on how many files the gate will load. */
const MAX_GATE_FILES = 200;
/** Per-file size cap to keep prompts bounded. */
const MAX_FILE_BYTES = 64 * 1024;

/**
 * ADR-041 — walk the cloned PR branch and return every source file as
 * a `GateTask` artifact. The constraint-agent + review-agent see
 * exactly the code CI just tested.
 *
 * Walks depth-first, skipping `SKIP_DIRS` and files outside
 * `SOURCE_FILE_EXTENSIONS`. Files larger than `MAX_FILE_BYTES` are
 * skipped (review-agent would truncate them anyway). The walk stops
 * at `MAX_GATE_FILES`; remaining files are dropped with a warning so
 * an operator-misconfigured project can't OOM the gate.
 */
async function readSourceFilesFromWorkDir(
  projectRoot: string,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<ArtifactRef[]> {
  const artifacts: ArtifactRef[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (artifacts.length >= MAX_GATE_FILES) {
      truncated = true;
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (artifacts.length >= MAX_GATE_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.') && entry.name !== '.eslintrc') continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extOf(entry.name);
      if (!SOURCE_FILE_EXTENSIONS.has(ext)) continue;
      const full = join(dir, entry.name);
      try {
        const st = await stat(full);
        if (st.size > MAX_FILE_BYTES) continue;
        const content = await readFile(full, 'utf8');
        const relPath = relative(projectRoot, full);
        artifacts.push({
          id: `${correlationId}:${relPath}`,
          type: relPath.includes('.test.') || relPath.includes('.spec.') ? 'test' : 'code',
          path: relPath,
          content,
        });
      } catch {
        // Best-effort — a single unreadable file shouldn't break the gate.
      }
    }
  }

  await walk(projectRoot);
  if (truncated) {
    childLog.warn(
      { fileCount: artifacts.length, max: MAX_GATE_FILES },
      'Gate source-file walk hit MAX_GATE_FILES — remaining files dropped',
    );
  }
  return artifacts;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
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

    // ADR-041 — when the gate is reviewing the PR branch post-CI,
    // check out that branch so the constraint-agent and review-agent
    // see exactly the code CI just tested. Without this the gate
    // would silently review `main` and produce misleading findings.
    if (payload.branch) {
      const repo = simpleGit(workDir);
      try {
        await repo.fetch('origin', payload.branch);
        await repo.checkout(['-B', payload.branch, `origin/${payload.branch}`]);
        childLog.info({ branch: payload.branch }, 'Checked out PR branch for gate review');
      } catch (err) {
        childLog.warn(
          { err: err instanceof Error ? err.message : String(err), branch: payload.branch },
          'Failed to checkout PR branch — reviewing default branch instead',
        );
      }
    }

    // Resolve the operator's intent text. The payload usually carries
    // it on a retry leg; on a first dispatch we fall back to the
    // persisted intent row. The review-agent uses this for scaffolding
    // detection — absent text falls through to a normal review.
    let intentText: string | undefined = payload.text;
    if (!intentText) {
      const intentRow = await getRepositories().intents.findById(payload.intentId);
      intentText = intentRow?.text ?? undefined;
    }

    // TEST_REPORT_002 Fix 3b — load the project's stack from
    // HARNESS.json so the constraint-agent can enforce the declared
    // test framework (and future rules can key off language /
    // packageManager). Best-effort; absent file falls through to
    // the framework-agnostic default.
    const stack = await loadHarnessStack(workDir);
    const harnessConfig: GateHarnessConfig = {
      ...defaultGateHarnessConfig(workDir),
      ...(stack ? { stack } : {}),
    };
    // ADR-041 — load source files from the cloned working tree when
    // the gate is reviewing post-CI. The pre-CI artifact-based path
    // is preserved as a fallback for any legacy in-flight jobs.
    const gateArtifacts: ArtifactRef[] = payload.readFromBranch
      ? await readSourceFilesFromWorkDir(workDir, correlationId, childLog)
      : payload.artifacts.map((a) => ({
          id: a.id,
          type: a.type,
          path: a.path,
          content: a.content,
        }));
    childLog.info(
      { artifactCount: gateArtifacts.length, mode: payload.readFromBranch ? 'branch' : 'artifacts' },
      'Gate artifacts resolved',
    );

    // TR_036 — assemble a project-structure brief from ARCHITECTURE.md
    // + a depth-2 directory tree under `src/`. The constraint-agent
    // and review-agent inject this BEFORE the rules section so they
    // can map abstract layer-role rules ("data access layer") to the
    // actual paths in the project being reviewed. Empty string when
    // the project has no ARCHITECTURE.md and no `src/` tree.
    const projectStructureBrief = await buildProjectStructureBrief(workDir);
    if (projectStructureBrief.length > 0) {
      childLog.debug(
        { bytes: projectStructureBrief.length },
        'Project-structure brief assembled for gate agents',
      );
    }

    const gateTask: GateTask = {
      taskId: message.id,
      correlationId,
      artifacts: gateArtifacts,
      harnessConfig,
      intentText,
      projectStructureBrief,
    };

    // BaseLLMAgent now owns LLM-call routing + lastModelUsed capture.
    // ReviewAgent.review(task) uses this.callLLM internally; we read
    // back `agent.lastPrompt` / `agent.lastLlmResponse` /
    // `agent.lastModelUsed` after the call to thread them into the
    // observability wrapper's execution-log persistence.
    //
    // TR_027 / ADR-051 — skip review-agent when PR-Agent already
    // posted its review and pipeline-agent has already routed
    // `changes-requested` through self-healing. constraint-agent
    // still runs (architectural-rule enforcement is not in
    // PR-Agent's scope).
    const skipReview = await shouldSkipReviewAgent(workDir);
    if (skipReview) {
      childLog.info(
        { workDir },
        'ADR-051 — PR-Agent enabled; gate skipping review-agent (constraint-agent still runs)',
      );
    }
    const reviewAgent = skipReview ? null : new ReviewAgent();

    // Run constraint + (optionally) review in parallel. Each step
    // persists its own agent_executions row and emits its own SSE
    // events; concurrency is safe because each owns its own DB rows.
    // TEST_REPORT_005 — constraint-agent now does a Stage-2 LLM
    // judgment pass. Forward the singleton's lastPrompt /
    // lastLlmResponse / lastModelUsed / lastTokensUsed onto the
    // result so the observability wrapper persists them on the
    // agent_executions row. The instance is reused across cycles
    // (it's stateless apart from the per-run `lastTokensUsed`
    // accumulator which `runJudgment` resets on entry).
    const constraintAgent = getConstraintAgentInstance();
    const constraintPromise = runWithObservability(
      'constraint-agent',
      'gate:constraint',
      correlationId,
      payload.intentId,
      async () => {
        const r = await runConstraintAgent(gateTask);
        const decorated = r as unknown as {
          lastPrompt?: string;
          llmResponse?: string;
          modelUsed?: string;
          tokensUsed?: number;
        };
        if (constraintAgent.lastPrompt) decorated.lastPrompt = constraintAgent.lastPrompt;
        if (constraintAgent.lastLlmResponse) decorated.llmResponse = constraintAgent.lastLlmResponse;
        if (constraintAgent.lastModelUsed) decorated.modelUsed = constraintAgent.lastModelUsed;
        if (constraintAgent.lastTokensUsed > 0) decorated.tokensUsed = constraintAgent.lastTokensUsed;
        // TR_035 / ADR-057 — forward per-call token-management
        // telemetry to the executionLogs.save site below.
        if (constraintAgent.lastTokenManagement) {
          (decorated as unknown as { tokenManagement?: unknown }).tokenManagement =
            constraintAgent.lastTokenManagement;
        }
        // TEST_REPORT_005 evolution — constraint-agent now drives a
        // tool-use loop (executeScript / readFile / searchFiles).
        // Forward the call log so the dashboard's tool-call panel
        // shows what the LLM actually ran.
        if (constraintAgent.lastToolCallLog.length > 0) {
          (decorated as unknown as { toolCalls?: typeof constraintAgent.lastToolCallLog }).toolCalls =
            constraintAgent.lastToolCallLog;
        }
        return r;
      },
      childLog,
    );

    const reviewPromise: Promise<GateAgentResult | null> = reviewAgent
      ? runWithObservability(
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
            // TR_035 / ADR-057 — token management telemetry.
            if (reviewAgent.lastTokenManagement) {
              (r as unknown as { tokenManagement?: unknown }).tokenManagement =
                reviewAgent.lastTokenManagement;
            }
            return r;
          },
          childLog,
        )
      : Promise.resolve(null);

    const [constraintRes, reviewRes] = await Promise.all([
      constraintPromise,
      reviewPromise,
    ]);

    const agentResults = reviewRes ? [constraintRes, reviewRes] : [constraintRes];
    const result = synthesiseGateResult(
      correlationId,
      agentResults,
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
      if (payload.readFromBranch) {
        // ADR-041 post-CI path — CI already validated the code on
        // this branch; gate just confirmed architectural compliance.
        // Hand straight off to promotion.
        await dispatchPromotion({
          message,
          payload,
          childLog,
        });
      } else {
        // Legacy pre-CI path — gate ran before the PR existed, so
        // it needs to dispatch deploy:pr to open it. Preserved for
        // backward compatibility with in-flight pre-ADR-041 jobs.
        await dispatchDeployPR({
          message,
          payload,
          childLog,
        });
      }
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
  // Fix D — every LLM-backed gate agent reports its accumulated
  // token count through the `tokensUsed` field on the decorated
  // result. As of TEST_REPORT_005 this includes constraint-agent
  // (Stage-2 LLM judgment) AND review-agent. Pre-LLM cycles where
  // Stage 1 produced zero candidates leave it undefined → 0.
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
    toolCalls?: Array<{ toolName: string; input: Record<string, unknown>; output: string; isError: boolean; calledAt: Date; toolSource?: string }>;
    /** TR_035 / ADR-057 — populated by LLM-backed gate agents
     *  (review-agent / constraint-agent) from
     *  `BaseLLMAgent.lastTokenManagement` after the run. */
    tokenManagement?: {
      originalPromptTokens: number;
      finalPromptTokens: number;
      reductionStrategy: 'phase-history-summarisation' | 'rules-compression' | 'architecture-trim' | null;
      budgetExpansions: number;
      finalMaxTokens: number;
      truncationOccurred: boolean;
    } | null;
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
    // TEST_REPORT_005 evolution — constraint-agent's executeScript /
    // readFile / searchFiles calls are persisted onto
    // `agent_execution_logs.tool_calls`. Empty for non-tool-using
    // gate agents.
    toolCalls: resultWithPrompt.toolCalls ?? [],
    tokenManagement: resultWithPrompt.tokenManagement ?? null,
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
/**
 * ADR-041 — gate pass after CI: hand off to promotion-agent (staging
 * first; promotion-agent dispatches the production leg itself).
 */
async function dispatchPromotion(args: {
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
  if (!projectId) {
    childLog.warn('Gate pass — cannot resolve projectId; skipping deploy:promotion');
    return;
  }

  await dispatch({
    id: crypto.randomUUID(),
    correlationId,
    type: 'deploy:promotion',
    sourceAgent: 'review-agent',
    targetAgent: 'promotion-agent',
    priority: (message.priority ?? 'normal') as TaskPriority,
    payload: {
      intentId: payload.intentId,
      projectId,
      targetEnvironment: 'staging',
      prNumber: payload.prNumber,
      branch: payload.branch,
      intentText,
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }, queueConfigFromEnv());

  childLog.info(
    { prNumber: payload.prNumber ?? null, branch: payload.branch ?? null },
    'Gate pass (post-CI) — dispatched deploy:promotion (staging)',
  );
}

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

  // TR_020 — absolute safety net. Use the intent's persisted
  // `attemptCount` as the source of truth — survives even if the
  // payload's retryCount got reset to 0 by an upstream regression.
  const intentRecord = await getRepositories().intents.findById(payload.intentId);
  const persistedAttempts = intentRecord?.attemptCount ?? 0;
  if (persistedAttempts >= ABSOLUTE_MAX_RETRIES) {
    childLog.warn(
      { persistedAttempts, max: ABSOLUTE_MAX_RETRIES, payloadRetryCount: retryCount },
      'Gate fail — absolute retry limit reached, escalating regardless of payload retryCount',
    );
    return false;
  }

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

  // TR_020 — every gate retry dispatch increments the intent's
  // persisted attempt counter. This drives both the ABSOLUTE_MAX_RETRIES
  // safety net above AND the self-healing loop's currentAttempt
  // computation (currently relied on by detectRepeatedSignalLoop +
  // the retry-introduced-violations escape hatch). Pre-TR_020, only
  // the self-healing-loop dispatch path incremented attemptCount, so
  // the plain maybeDispatchRetry path never moved the counter.
  await getRepositories().intents.incrementAttemptCount(payload.intentId);

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

  const retryPayload: GenerateRetryPayload & {
    resumeOnBranch?: string;
    prNumber?: number;
    prUrl?: string;
  } = {
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
    // ADR-041 — when the gate was triggered post-CI (`readFromBranch`
    // mode), the cycle already has an open PR on `branch`. Hand the
    // branch back to the generate orchestrator so the regen sits on
    // top of the existing history; pr-agent's resume leg pushes the
    // fix commit to the same branch, CI re-triggers automatically,
    // and the gate re-runs against the new code. Without this, the
    // retry would open a SECOND PR on a fresh branch and the original
    // PR would hang.
    ...(payload.branch ? { resumeOnBranch: payload.branch } : {}),
    ...(payload.prNumber !== undefined ? { prNumber: payload.prNumber } : {}),
    ...(payload.prUrl ? { prUrl: payload.prUrl } : {}),
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

/**
 * TR_036 — Assemble a project-structure brief from ARCHITECTURE.md +
 * a depth-2 directory listing under `src/`. The brief is injected
 * BEFORE the rules section in the constraint-agent + review-agent
 * prompts so abstract layer-role rules ("data access layer") can be
 * mapped to the actual paths in the project being reviewed.
 *
 * Per ADR-050 the platform does not interpret the brief — it just
 * enumerates ARCHITECTURE.md text + directory paths and hands them
 * to the agent. ARCHITECTURE.md is truncated to 2000 chars to keep
 * the gate prompt within budget; the agent can `readFile` the full
 * version if it needs more.
 *
 * Returns an empty string when neither source is present — callers
 * test `length > 0` and omit the section entirely in that case.
 */
async function buildProjectStructureBrief(projectRoot: string): Promise<string> {
  let architectureMd = '';
  try {
    architectureMd = await readFile(join(projectRoot, 'ARCHITECTURE.md'), 'utf8');
  } catch {
    // Not all projects have ARCHITECTURE.md yet — that's fine.
  }

  // Depth-2 listing under `src/`: equivalent to
  // `find src -maxdepth 2 -type d`. Limit to 30 entries to keep the
  // brief bounded.
  const dirEntries: string[] = [];
  try {
    const srcRoot = join(projectRoot, 'src');
    const top = await readdir(srcRoot, { withFileTypes: true });
    for (const entry of top) {
      if (!entry.isDirectory()) continue;
      dirEntries.push(`src/${entry.name}`);
      try {
        const inner = await readdir(join(srcRoot, entry.name), { withFileTypes: true });
        for (const sub of inner) {
          if (!sub.isDirectory()) continue;
          dirEntries.push(`src/${entry.name}/${sub.name}`);
          if (dirEntries.length >= 30) break;
        }
      } catch {
        // Subdir unreadable — skip.
      }
      if (dirEntries.length >= 30) break;
    }
  } catch {
    // No `src/` tree — fall through; the brief may still contain
    // ARCHITECTURE.md content alone.
  }

  if (architectureMd.length === 0 && dirEntries.length === 0) {
    return '';
  }

  const parts: string[] = [
    '## Project structure (read before evaluating)',
    '',
    "Use this to understand the project's layers and boundaries.",
    'Rules in this evaluation refer to these layers by their role',
    '(data access layer, business logic layer, etc.) — map them to',
    'the actual directories and files shown here.',
    '',
  ];

  if (architectureMd.length > 0) {
    parts.push('### Architecture');
    parts.push(architectureMd.slice(0, 2000));
    parts.push('');
  }

  if (dirEntries.length > 0) {
    parts.push('### Directory structure');
    parts.push('```');
    parts.push(dirEntries.join('\n'));
    parts.push('```');
    parts.push('');
  }

  return parts.join('\n');
}
