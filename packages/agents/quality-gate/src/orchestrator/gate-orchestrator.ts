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

import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import {
  createWorker, getRepositories,
  createContextLogger, emitLiveEvent, QUEUE_NAMES,
  BaseOrchestrator,
  resolveProjectCredential,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig,
  PlatformSignal, ExecutionStatus, IntentStatus,
} from '@gestalt/core';
import type {
  GateAgentResult, GateAgentRole, GateHarnessConfig, GateSignal, ArtifactRef,
} from '../types';
import { runGateGraph } from '../graphs/gate/graph';

// TR_056 Part 2d — MAX_GATE_RETRIES / ABSOLUTE_MAX_RETRIES constants
// moved to the GateGraph layer:
//   - The hard ABSOLUTE_MAX_RETRIES=5 DB cross-check lives in
//     `selfHealingGateNode` (graphs/shared/self-healing-node.ts:84+).
//   - The per-payload MAX_GATE_RETRIES budget is the loop's responsibility
//     via `runSelfHealingLoop`'s per-failure-type `maxAttempts`.
// Neither constant is referenced from this orchestrator any more.

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

// TR_056 Part 2d — `GenerateRetryPayload` was only read by
// `maybeDispatchRetry` (deleted). The graph's `selfHealingGateNode`
// dispatches the retry via `runSelfHealingLoop`, which mints its
// own payload from the diagnostician's `retryTaskType` choice.

/**
 * Embed a Git PAT into an HTTPS clone URL. Mirrors the helper in
 * generate's orchestrator (same shape, same auth contract).
 */
export function authenticatedGitUrl(gitUrl: string, token: string): string {
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
export async function transitionIntent(
  intentId: string,
  correlationId: string,
  status: IntentStatus,
): Promise<void> {
  const { intents } = getRepositories();
  const updated = await intents.updateStatus(intentId, status);
  // TR_053 amendment — enrich event payload with the persisted
  // parent context (PlanningGraph reads this to route resume signals).
  emitLiveEvent('intent.status-changed', correlationId, {
    intentId,
    status,
    parentContext: updated.parentContext ?? null,
  });
}

/**
 * Looks up the project for this correlationId via the intents table so
 * the gate worker can resolve the gitUrl + PAT without the generate
 * orchestrator having to redundantly thread projectId on the queue.
 */
export async function resolveProjectFor(intentId: string): Promise<{
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
// TR_056 — helpers exported so the GateGraph nodes can reuse them
// without copy-paste. The legacy `handleGateTask` is now a thin
// invoker (see end of file); the agent-run logic lives in
// `graphs/gate/nodes.ts`.
export function defaultGateHarnessConfig(projectRoot: string): GateHarnessConfig {
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
export async function loadHarnessStack(projectRoot: string): Promise<GateHarnessConfig['stack'] | undefined> {
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
export async function shouldSkipReviewAgent(projectRoot: string): Promise<boolean> {
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
export async function readSourceFilesFromWorkDir(
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

/**
 * TR_056 Part 2c / 2d — thin invoker.
 *
 * The verdict / dispatch / self-healing logic lives in the
 * GateGraph (graphs/gate/{state.ts,nodes.ts,graph.ts,
 * ../shared/self-healing-node.ts}). `handleGateTask` is:
 *
 *   1. Resolve the payload into a `RunGateGraphStartInput`.
 *   2. Call `runGateGraph({mode: 'start', ...})`.
 *   3. Return a `TaskResult` — the BullMQ worker's success-or-throw
 *      contract (see `packages/core/src/queue/index.ts:184-189`)
 *      treats any non-throwing return as job COMPLETED. Per TR_053
 *      Fix 5: this is exactly how the planning graph's
 *      `handleGraphStart` already behaves.
 *
 * Routing decisions (pass→deploy:promotion/deploy:pr, fail→
 * self-healing, escalate→alert) all live inside the graph.
 *
 * 2d note: the legacy body (`legacyHandleGateTask`) + five dispatch
 * helpers (`dispatchPromotion`, `dispatchDeployPR`, `maybeDispatchRetry`,
 * `attemptSelfHealingForGate`, `createBreachAlert`) were preserved
 * through 2c as a one-line revert path; they are deleted in 2d
 * because the routing change held under code review and the
 * structural invariant (`startGateWorker → createWorker registers
 * handleGateTask → handleGateTask only calls runGateGraph`) makes
 * any future regression a re-compilation failure, not a silent
 * fall-back. To revert post-2d, use `git revert` on the 2d commit.
 */
async function handleGateTask(message: TaskMessage<GateTaskPayload>): Promise<TaskResult> {
  const { correlationId } = message;
  const payload = message.payload;
  const childLog = createContextLogger({ module: 'gate-orchestrator', correlationId });
  const startedAt = new Date();

  childLog.info(
    { intentId: payload.intentId, routedBy: 'gate-graph (TR_056 Part 2c)' },
    'Quality gate received task — invoking GateGraph',
  );

  // Pre-resolve the intent text so the graph node doesn't repeat
  // the DB read when the payload already carries it.
  let intentText: string | undefined = payload.text;
  if (!intentText) {
    try {
      const intentRow = await getRepositories().intents.findById(payload.intentId);
      intentText = intentRow?.text ?? undefined;
    } catch (err) {
      childLog.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Thin invoker: intent-text pre-lookup failed; graph will retry inside gateNode',
      );
    }
  }

  // Pre-resolve projectId from the intent if absent from payload —
  // same fallback the legacy body uses, surfaced once here so the
  // graph state is fully populated before invoke.
  let projectId: string | undefined = payload.projectId;
  if (!projectId) {
    try {
      const intentRow = await getRepositories().intents.findById(payload.intentId);
      projectId = intentRow?.projectId ?? undefined;
    } catch {
      // Best-effort; the graph node will re-resolve.
    }
  }

  const graphResult = await runGateGraph({
    mode: 'start',
    correlationId,
    intentId: payload.intentId,
    projectId: projectId ?? null,
    intentText: intentText ?? null,
    branch: payload.branch ?? null,
    prNumber: payload.prNumber ?? null,
    prUrl: payload.prUrl ?? null,
    ciRunId: payload.ciRunId ?? null,
    readFromBranch: payload.readFromBranch === true,
    resumeOnBranch: payload.resumeOnBranch ?? null,
    artifacts: payload.artifacts.map((a) => ({
      id: a.id,
      correlationId: a.correlationId,
      type: a.type,
      path: a.path,
      content: a.content,
      producedBy: a.producedBy,
      createdAt: typeof a.createdAt === 'string'
        ? a.createdAt
        : a.createdAt instanceof Date
          ? a.createdAt.toISOString()
          : undefined,
    })),
    retryCount: payload.retryCount ?? 0,
  });

  childLog.info(
    {
      intentId: payload.intentId,
      verdict: graphResult.verdict,
      selfHealingOutcome: graphResult.selfHealingOutcome,
      interrupted: graphResult.interrupted,
      errorCount: graphResult.errors.length,
    },
    'GateGraph step returned — completing BullMQ job (interrupt-return = job success per TR_053 Fix 5)',
  );

  // Map the graph's verdict to a BullMQ TaskResult shape. The worker
  // treats any non-throwing return as COMPLETED; status:'failed' here
  // is observability-only (mirrors the planning graph's pattern).
  // `interrupted: true` from runGateGraph today means "human-feedback
  // node ran with no interrupt() call" — terminal-acceptable per §3
  // until the resume signal is wired.
  return {
    taskId: message.id,
    correlationId,
    agentRole: 'review-agent',
    status: graphResult.verdict === 'pass' ? 'completed' : 'failed',
    output: {
      verdict: graphResult.verdict ?? 'unknown',
      selfHealingOutcome: graphResult.selfHealingOutcome ?? null,
      reachedEnd: graphResult.reachedEnd,
      interrupted: graphResult.interrupted,
    },
    signals: [],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt.getTime(),
    completedAt: new Date(),
  };
}


/**
 * Wraps a gate-agent run with the same DB + SSE observability pattern the
 * generate orchestrator uses: creates the `agent_executions` row, runs
 * the agent, persists its signals, updates the row to a terminal status,
 * and emits `agent.started` / `agent.completed` / `signal.emitted` along
 * the way.
 */
export async function runWithObservability<T extends GateAgentResult>(
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
    // TR_053 NRB-1 — attach the executionId + error message to the
    // errored result so the orchestrator can patch the row to
    // `completed-with-warning` post-verdict when the other gate
    // agent's verdict was an independent `pass`. Keeps the cast
    // contained to this single call site.
    return {
      agentRole,
      status: 'errored',
      signals: [],
      durationMs: completedAt.getTime() - startedAt.getTime(),
      _executionId: executionId,
      _errorMessage: err instanceof Error ? err.message : String(err),
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
      reasoningEffort: 'xhigh' | 'high' | 'medium' | 'low' | 'non-reasoning' | null;
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
export function gateSignalToPlatformSignal(s: GateSignal): PlatformSignal {
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
export async function buildProjectStructureBrief(projectRoot: string): Promise<string> {
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
