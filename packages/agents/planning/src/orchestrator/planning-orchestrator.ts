/**
 * Planning layer orchestrator — main BullMQ worker.
 *
 * Drives the feature decomposition + phased execution loop:
 *
 *   planning:start    — clone repo → architecture-agent (feature) →
 *                       planner-agent → write PLAN.md + commit → push →
 *                       dispatch planning:phase for phase 0
 *
 *   planning:phase    — clone repo → (optional) architecture-agent (phase) →
 *                       create intent row → dispatch generate:intent →
 *                       record intent_id on feature_phases
 *
 *   planning:evaluate — clone repo → phase-evaluator-agent → apply
 *                       adjustments to remaining phases → write PLAN.md
 *                       update + commit → push → dispatch next
 *                       planning:phase OR mark feature completed
 *
 * The orchestrator also subscribes to the in-process event bus to
 * convert `intent.status-changed` events (status=deployed / failed)
 * into `planning:evaluate` dispatches when the intent belongs to a
 * planner-driven phase. This is the "deploy → planning" callback
 * without any coupling code in the deploy layer.
 *
 * Path-guarded mutations:
 *   - PLAN.md          → write at repo root only
 *   - docs/ARCHITECTURE.md → architecture-agent's update appended only;
 *                            existing content preserved (additive)
 *
 * Pure platform mechanics. All LLM-facing guidance lives in
 * HARNESS.json + agents.yaml; this file owns the loop logic, queue
 * dispatch, persistence, and git operations only.
 */

import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  createWorker, dispatch, getRepositories, getQueueConfig,
  createContextLogger, emitLiveEvent, eventBus, QUEUE_NAMES,
  createHarnessEngine, resolveProjectCredential,
} from '@gestalt/core';
import type {
  TaskMessage, TaskResult, QueueConfig, TaskPriority,
  FeatureRecord, FeaturePhaseRecord, HarnessConfig,
} from '@gestalt/core';
import { ArchitectureAgent } from '../agents/architecture-agent';
import { PlannerAgent } from '../agents/planner-agent';
import { PhaseEvaluatorAgent } from '../agents/phase-evaluator-agent';
import type { FeatureArchitecture, FeaturePlan, PhaseEvaluation } from '../types';

const log = createContextLogger({ module: 'planning-orchestrator' });

// ─── Task payload shapes ─────────────────────────────────────────────

interface PlanningStartPayload {
  featureId: string;
}

interface PlanningPhasePayload {
  featureId: string;
  phaseIndex: number;
}

interface PlanningEvaluatePayload {
  featureId: string;
  phaseId: string;
  intentDeployedSuccessfully: boolean;
}

type PlanningPayload =
  | PlanningStartPayload
  | PlanningPhasePayload
  | PlanningEvaluatePayload;

// ─── Defaults — overridable per project via HARNESS.json.planner ────

const DEFAULT_MAX_PHASES = 10;
const DEFAULT_MAX_FILES_PER_PHASE = 5;
// TR_022 — default phase retry budget (one initial attempt + 2
// retries = 3 total attempts per phase). Operators tune via
// `HARNESS.json.planner.maxPhaseRetries`. Set to 0 to restore the
// pre-TR_022 behaviour (one attempt, no retry).
const DEFAULT_MAX_PHASE_RETRIES = 2;

// ─── Helpers ─────────────────────────────────────────────────────────

function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) {
    return gitUrl;
  }
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * TR_033 — terminate a feature when its in-flight phase intent hits an
 * escalation-class status. Self-healing parks the parent intent at
 * `waiting-for-clarification` once the cascade-depth brake fires; without
 * this helper the planner would leave the feature in `in-progress` until
 * an operator intervenes manually (the gap the TR_032 verification
 * surfaced).
 *
 * The sequence is intentionally simple — there is nothing for the
 * phase-evaluator to do (no PR branch to diff, no scope adjustment to
 * apply), so we skip planning:evaluate entirely. Order: phase status →
 * feature status → plan log → alert. Each step swallows its own
 * exception via the surrounding catch in the subscriber.
 */
async function markFeatureBlockedAfterEscalation(args: {
  featureId: string;
  phaseId: string;
  phaseIndex: number;
  phaseTitle: string;
  intentId: string;
  correlationId: string;
  status: string;
}): Promise<void> {
  const { features, alerts } = getRepositories();
  log.warn(
    {
      featureId: args.featureId,
      phaseId: args.phaseId,
      intentId: args.intentId,
      phaseIndex: args.phaseIndex,
      status: args.status,
    },
    'Planner phase intent escalated — marking phase failed + feature blocked',
  );
  await features.updatePhaseStatus(args.phaseId, 'failed');
  await features.updateStatus(args.featureId, 'blocked');
  await features.appendLog({
    featureId: args.featureId,
    phaseIndex: args.phaseIndex,
    eventType: 'phase-escalated',
    summary:
      `Phase ${args.phaseIndex + 1} (${args.phaseTitle}) escalated ` +
      `to '${args.status}' — feature blocked automatically. ` +
      `Self-healing budget exhausted; human clarification required to resume.`,
    detail: { intentId: args.intentId, status: args.status },
  });
  const alert = await alerts.create({
    correlationId: args.correlationId,
    intentId: args.intentId,
    type: 'feature-blocked',
    severity: 'high',
    title: `Feature blocked at phase ${args.phaseIndex + 1}`,
    description:
      `Phase ${args.phaseIndex + 1} (${args.phaseTitle}) escalated after ` +
      `self-healing budget was exhausted. ` +
      `Human clarification required to resume.`,
    requiredAction: 'review-manually',
    context: {
      featureId: args.featureId,
      phaseId: args.phaseId,
      phaseIndex: args.phaseIndex,
      phaseTitle: args.phaseTitle,
      intentId: args.intentId,
      escalationStatus: args.status,
    },
  });
  emitLiveEvent('alert.created', args.correlationId, {
    alertId: alert.id,
    type: 'feature-blocked',
    intentId: args.intentId,
    severity: 'high',
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Worker boot ─────────────────────────────────────────────────────

export function startPlanningWorker(queueConfig: QueueConfig): void {
  createWorker<PlanningPayload>(
    QUEUE_NAMES.planning,
    handlePlanningTask,
    queueConfig,
    { concurrency: 2 },
  );

  // Subscribe to `intent.status-changed` events. When a phase intent
  // reaches a terminal status, dispatch a planning:evaluate task so
  // the loop continues. The subscription stays alive for the process
  // lifetime — no unsubscribe is registered.
  //
  // TR_033 — `waiting-for-clarification` is also handled here as a
  // terminal phase outcome. Self-healing parks a parent intent at
  // `waiting-for-clarification` when the cascade-depth brake fires
  // (see `self-healing-loop.ts`); pre-TR_033 the planning subscriber
  // filtered that status out, leaving the parent feature stuck
  // `in-progress` indefinitely and forcing manual operator cleanup
  // (the TR_032 verification surfaced this). The new branch marks
  // the phase `failed` + feature `blocked` + emits a single clear
  // `feature-blocked` alert so the operator sees the situation
  // immediately.
  eventBus.subscribe(async (event) => {
    if (event.type !== 'intent.status-changed') return;
    const payload = event.payload as { intentId?: string; status?: string };
    const intentId = payload?.intentId;
    const status = payload?.status;
    if (!intentId || !status) return;
    if (
      status !== 'deployed' &&
      status !== 'failed' &&
      status !== 'escalated' &&
      status !== 'waiting-for-clarification'
    ) {
      return;
    }
    try {
      const { features } = getRepositories();
      const phase = await features.findPhaseByIntent(intentId);
      if (!phase) return;  // Not a planner-driven intent — ignore.

      // TR_033 — escalation-class statuses are terminal failures for
      // the phase. Don't dispatch planning:evaluate; the phase didn't
      // produce evaluable output. Mark everything terminal in one
      // sequence so the dashboard reflects reality immediately.
      if (status === 'waiting-for-clarification' || status === 'escalated') {
        await markFeatureBlockedAfterEscalation({
          featureId: phase.featureId,
          phaseId: phase.id,
          phaseIndex: phase.phaseIndex,
          phaseTitle: phase.title,
          intentId,
          correlationId: event.correlationId,
          status,
        });
        return;
      }

      log.info(
        { featureId: phase.featureId, phaseId: phase.id, intentId, status },
        'Planner phase intent reached terminal status — dispatching planning:evaluate',
      );
      await dispatch<PlanningEvaluatePayload>({
        id: crypto.randomUUID(),
        correlationId: event.correlationId,
        type: 'planning:evaluate',
        sourceAgent: 'orchestrator',
        targetAgent: 'phase-evaluator-agent',
        priority: 'normal',
        payload: {
          featureId: phase.featureId,
          phaseId: phase.id,
          intentDeployedSuccessfully: status === 'deployed',
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }, getQueueConfig());
    } catch (err) {
      log.error({ err }, 'planning event-bus subscriber failed');
    }
  });

  log.info('Planning orchestrator worker started');
}

// ─── Main handler ────────────────────────────────────────────────────

async function handlePlanningTask(
  message: TaskMessage<PlanningPayload>,
): Promise<TaskResult> {
  const startedAt = Date.now();
  const { correlationId, type } = message;
  const childLog = createContextLogger({
    module: 'planning-orchestrator', correlationId, taskType: type,
  });

  try {
    switch (type) {
      case 'planning:start':
        await handlePlanningStart(message.payload as PlanningStartPayload, correlationId, childLog);
        break;
      case 'planning:phase':
        await handlePlanningPhase(message.payload as PlanningPhasePayload, correlationId, childLog);
        break;
      case 'planning:evaluate':
        await handlePlanningEvaluate(message.payload as PlanningEvaluatePayload, correlationId, childLog);
        break;
      default:
        throw new Error(`Planning orchestrator received unknown task type: ${type}`);
    }
    return {
      taskId: message.id,
      correlationId,
      agentRole: 'orchestrator',
      status: 'completed',
      output: { taskType: type },
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
    };
  } catch (err) {
    childLog.error({ err }, 'Planning orchestrator error');
    const payload = message.payload as { featureId?: string };
    if (payload?.featureId) {
      try {
        const { features } = getRepositories();
        await features.updateStatus(payload.featureId, 'blocked');
        await features.appendLog({
          featureId: payload.featureId,
          phaseIndex: null,
          eventType: 'feature-failed',
          summary: err instanceof Error ? err.message.slice(0, 500) : 'planning orchestrator threw',
          detail: null,
        });
      } catch {
        // best-effort — never throw out of the catch block
      }
    }
    return {
      taskId: message.id,
      correlationId,
      agentRole: 'orchestrator',
      status: 'failed',
      output: null,
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
    };
  }
}

// ─── planning:start ──────────────────────────────────────────────────

async function handlePlanningStart(
  payload: PlanningStartPayload,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<void> {
  const { features, projects } = getRepositories();
  const feature = await features.findById(payload.featureId);
  if (!feature) throw new Error(`Feature ${payload.featureId} not found`);

  const project = await projects.findById(feature.projectId);
  if (!project) throw new Error(`Project ${feature.projectId} not found`);

  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential on file`);

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-${correlationId}-`));
  try {
    childLog.info({ featureId: feature.id, workDir }, 'Cloning project for planning:start');
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir);

    const repo = simpleGit(workDir);
    try { await repo.checkout(project.defaultBranch); } catch { /* brand-new repo */ }

    // Read existing context + harness.
    const archMd = await readFileSafe(join(workDir, 'docs/ARCHITECTURE.md'));
    let harnessConfig: HarnessConfig | null = null;
    try {
      const snap = await createHarnessEngine(workDir).buildSnapshot(correlationId);
      harnessConfig = snap.harness;
    } catch (err) {
      childLog.warn({ err }, 'planning:start could not read HARNESS.json — proceeding without project rules');
    }

    const bounds = boundsFromHarness(harnessConfig);

    // ── 1. architecture-agent (feature-level) ─────────────────────
    childLog.info({ featureId: feature.id }, 'Invoking architecture-agent for feature-level design');
    const architectureAgent = new ArchitectureAgent();
    const draftArchitecture = await architectureAgent.designFeature(
      feature, archMd, workDir, harnessConfig, correlationId,
    );

    // STOPGAP (ADR-056): This single-agent review step is a
    // lightweight stand-in for the LangGraph architecture crew
    // (domain + data + application architects deliberating in
    // parallel under a chief-architect supervisor) that Phase 1
    // of the migration will introduce. When the crew lands,
    // delete `reviewDesign()`, `buildArchitectureReviewPrompt`,
    // and this call site.
    childLog.info({ featureId: feature.id }, 'Invoking architecture-agent reviewDesign (TR_038 stopgap)');
    const architecture = await architectureAgent.reviewDesign(
      draftArchitecture, feature, workDir, harnessConfig, correlationId,
    );

    await features.appendLog({
      featureId: feature.id,
      phaseIndex: null,
      eventType: 'architecture-designed',
      summary: `Feature architecture: ${architecture.modules.length} module(s), ${architecture.recommendedPhases.length} recommended phase(s)`,
      detail: architecture as unknown,
    });

    // ── 2. planner-agent ──────────────────────────────────────────
    childLog.info({ featureId: feature.id }, 'Invoking planner-agent for phase decomposition');
    const plan = await new PlannerAgent().planFeature(
      feature, architecture, workDir, harnessConfig, bounds, correlationId,
    );
    if (plan.phases.length === 0) {
      childLog.warn({ featureId: feature.id }, 'planner-agent returned zero phases — marking feature blocked');
      await features.updateStatus(feature.id, 'blocked');
      await features.appendLog({
        featureId: feature.id,
        phaseIndex: null,
        eventType: 'plan-empty',
        summary: 'planner-agent returned zero phases',
        detail: null,
      });
      return;
    }

    // Persist phases + the feature's architecture summary.
    const architectureSummary = JSON.stringify(architecture, null, 2);
    await features.saveArchitectureAndPlan(feature.id, {
      architecture: architectureSummary,
      phaseCount: plan.phases.length,
    });
    for (let i = 0; i < plan.phases.length; i++) {
      const p = plan.phases[i]!;
      await features.createPhase({
        id: crypto.randomUUID(),
        featureId: feature.id,
        phaseIndex: i,
        title: p.title,
        scope: p.scope,
        architecture: p.architecture ?? null,
        dependencies: p.dependencies,
      });
    }
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: null,
      eventType: 'plan-built',
      summary: `Plan built: ${plan.phases.length} phase(s)`,
      detail: { phases: plan.phases.map((p) => p.title) },
    });

    // ── 3. Write PLAN.md + commit + push ──────────────────────────
    await writePlanMd(workDir, feature, architecture, plan);
    await maybeAppendArchitectureMd(workDir, architecture);
    await commitAndPush(repo, project.defaultBranch, `chore(planning): add PLAN.md for ${feature.title} [gestalt-planning]`);

    // ── 4. Dispatch first phase ───────────────────────────────────
    emitLiveEvent('intent.status-changed', correlationId, { featureId: feature.id, status: 'planning-complete' });
    await dispatch<PlanningPhasePayload>({
      id: crypto.randomUUID(),
      correlationId,
      type: 'planning:phase',
      sourceAgent: 'orchestrator',
      targetAgent: 'planner-agent',
      priority: 'normal' as TaskPriority,
      payload: { featureId: feature.id, phaseIndex: 0 },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, getQueueConfig());
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── planning:phase ──────────────────────────────────────────────────

async function handlePlanningPhase(
  payload: PlanningPhasePayload,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<void> {
  const { features, intents, projects } = getRepositories();
  const feature = await features.findById(payload.featureId);
  if (!feature) throw new Error(`Feature ${payload.featureId} not found`);
  const project = await projects.findById(feature.projectId);
  if (!project) throw new Error(`Project ${feature.projectId} not found`);

  const phase = await features.findPhaseByIndex(feature.id, payload.phaseIndex);
  if (!phase) throw new Error(`Phase ${payload.phaseIndex} of feature ${feature.id} not found`);

  // ── Per-phase architecture pass (optional, HARNESS-gated) ───────
  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential on file`);

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-phase-${correlationId}-`));
  try {
    childLog.info({ featureId: feature.id, phaseIndex: phase.phaseIndex, workDir }, 'Cloning for planning:phase');
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir);

    const repo = simpleGit(workDir);
    try { await repo.checkout(project.defaultBranch); } catch { /* brand-new repo */ }

    let harnessConfig: HarnessConfig | null = null;
    try {
      const snap = await createHarnessEngine(workDir).buildSnapshot(correlationId);
      harnessConfig = snap.harness;
    } catch (err) {
      childLog.warn({ err }, 'planning:phase could not read HARNESS.json');
    }

    const phaseArchitectureUpdate = harnessConfig?.planner?.architectureReviewPerPhase === true
      ? await runPerPhaseArchitecture(feature, phase, workDir, harnessConfig, correlationId, childLog)
      : null;

    // Build the final intent text by stitching scope + architecture +
    // dependency callouts together.
    const intentText = buildPhaseIntentText(feature, phase, phaseArchitectureUpdate);

    // Create + dispatch a generate:intent.
    const newCorrelationId = crypto.randomUUID();
    const intent = await intents.create({
      id: crypto.randomUUID(),
      correlationId: newCorrelationId,
      projectId: feature.projectId,
      text: intentText,
      status: 'pending',
      source: 'human',
      priority: 'normal',
    });
    await features.updatePhaseIntent(phase.id, intent.id);
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-submitted',
      summary: `Phase ${phase.phaseIndex + 1}/${feature.phaseCount}: ${phase.title} — intent ${intent.id.slice(0, 8)}`,
      detail: { intentId: intent.id, correlationId: newCorrelationId },
    });
    await intents.updateStatus(intent.id, 'generating');
    emitLiveEvent('intent.created', newCorrelationId, {
      intentId: intent.id, text: intentText, priority: 'normal',
      featureId: feature.id, phaseIndex: phase.phaseIndex,
    });
    await dispatch({
      id: crypto.randomUUID(),
      correlationId: newCorrelationId,
      type: 'generate:intent',
      sourceAgent: 'orchestrator',
      targetAgent: 'intent-agent',
      priority: 'normal' as TaskPriority,
      payload: { intentId: intent.id, text: intentText, projectId: feature.projectId },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, getQueueConfig());

    childLog.info(
      { featureId: feature.id, phaseId: phase.id, intentId: intent.id, newCorrelationId },
      'Phase intent dispatched',
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runPerPhaseArchitecture(
  feature: FeatureRecord,
  phase: FeaturePhaseRecord,
  workDir: string,
  harnessConfig: HarnessConfig | null,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<string | null> {
  try {
    const { features } = getRepositories();
    const priorPhases = (await features.listPhases(feature.id)).filter((p) => p.phaseIndex < phase.phaseIndex);
    const archMd = feature.architecture ?? '';
    const pa = await new ArchitectureAgent().designPhase(
      feature, phase.title, phase.architecture ?? phase.scope,
      archMd, priorPhases, workDir, harnessConfig, correlationId,
    );
    const summary = JSON.stringify(pa);
    // TR_034 — persist the scoped PhaseArchitecture JSON onto
    // `feature_phases.architecture` so `aider-code-agent` can read it
    // back via `findPhaseByIntent` and render the Aider message's
    // "Scoped architecture for this phase" block. The planner's
    // optional initial architecture text is overwritten — it was
    // already consumed by `designPhase()` as input.
    await features.updatePhaseArchitecture(phase.id, summary);
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-architecture-designed',
      summary: `Phase ${phase.phaseIndex + 1} architecture: ${pa.interfaces.length} interface(s), ${pa.successCriteria.length} criteria`,
      detail: pa as unknown,
    });
    return summary;
  } catch (err) {
    childLog.warn({ err }, 'Per-phase architecture pass failed — proceeding without it');
    return null;
  }
}

function buildPhaseIntentText(
  feature: FeatureRecord,
  phase: FeaturePhaseRecord,
  perPhaseArchitecture: string | null,
): string {
  const parts: string[] = [];
  parts.push(`[Feature: ${feature.title} — Phase ${phase.phaseIndex + 1}: ${phase.title}]`);
  parts.push('');
  parts.push(phase.scope);
  if (phase.dependencies.length > 0) {
    parts.push('');
    parts.push(`This phase depends on: ${phase.dependencies.join(', ')}.`);
  }
  if (phase.architecture) {
    parts.push('');
    parts.push('Phase architecture notes:');
    parts.push(phase.architecture);
  }
  if (perPhaseArchitecture) {
    parts.push('');
    parts.push('Detailed phase architecture (architecture-agent):');
    parts.push(perPhaseArchitecture);
  }
  return parts.join('\n');
}

// ─── planning:evaluate ───────────────────────────────────────────────

async function handlePlanningEvaluate(
  payload: PlanningEvaluatePayload,
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<void> {
  const { features, projects } = getRepositories();
  const feature = await features.findById(payload.featureId);
  if (!feature) throw new Error(`Feature ${payload.featureId} not found`);
  const phase = (await features.listPhases(feature.id)).find((p) => p.id === payload.phaseId);
  if (!phase) throw new Error(`Phase ${payload.phaseId} not found`);
  const project = await projects.findById(feature.projectId);
  if (!project) throw new Error(`Project ${feature.projectId} not found`);

  if (!payload.intentDeployedSuccessfully) {
    // TR_022 — honour `planner.maxPhaseRetries` (default 2). Quick
    // shallow clone just to read HARNESS.json; on any failure we
    // fall back to the platform default. Faster than a full clone +
    // harness snapshot because we only need one field.
    const maxPhaseRetries = await readMaxPhaseRetries(project, correlationId, childLog);
    if (phase.retryCount < maxPhaseRetries) {
      const newRetryCount = await features.incrementPhaseRetry(phase.id);
      await features.appendLog({
        featureId: feature.id,
        phaseIndex: phase.phaseIndex,
        eventType: 'phase-retry',
        summary: `Phase ${phase.phaseIndex + 1} (${phase.title}) failed — retry ${newRetryCount}/${maxPhaseRetries}`,
        detail: { retryCount: newRetryCount, maxPhaseRetries },
      });
      childLog.info(
        { featureId: feature.id, phaseId: phase.id, retryCount: newRetryCount, maxPhaseRetries },
        'Phase failed — retrying within budget',
      );
      await dispatch<PlanningPhasePayload>({
        id: crypto.randomUUID(),
        correlationId,
        type: 'planning:phase',
        sourceAgent: 'orchestrator',
        targetAgent: 'planner-agent',
        priority: 'normal' as TaskPriority,
        payload: { featureId: feature.id, phaseIndex: phase.phaseIndex },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }, getQueueConfig());
      return;
    }

    childLog.warn(
      { featureId: feature.id, phaseId: phase.id, retryCount: phase.retryCount, maxPhaseRetries },
      'Phase retry budget exhausted — marking phase failed and feature blocked',
    );
    await features.updatePhaseStatus(phase.id, 'failed');
    await features.updateStatus(feature.id, 'blocked');
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-failed',
      summary: `Phase ${phase.phaseIndex + 1} (${phase.title}) failed after ${maxPhaseRetries} retries — feature blocked`,
      detail: { retryCount: phase.retryCount, maxPhaseRetries },
    });
    // TR_036 — surface this terminal block in the alerts feed.
    // Previously only the self-healing cascade-brake escalation
    // path (via `markFeatureBlockedAfterEscalation`) created an
    // alert; the planner's `maxPhaseRetries` exhaustion path was
    // silent and operators only discovered the failure via the
    // dashboard / `gestalt feature show`.
    const { alerts } = getRepositories();
    const alert = await alerts.create({
      correlationId,
      intentId: phase.intentId,
      type: 'feature-blocked',
      severity: 'high',
      title: `Feature blocked at phase ${phase.phaseIndex + 1}`,
      description:
        `Phase ${phase.phaseIndex + 1} (${phase.title}) failed after ` +
        `${maxPhaseRetries} retry attempt${maxPhaseRetries === 1 ? '' : 's'}. ` +
        `Human review required to resume.`,
      requiredAction: 'review-manually',
      context: {
        featureId: feature.id,
        phaseId: phase.id,
        phaseIndex: phase.phaseIndex,
        phaseTitle: phase.title,
        intentId: phase.intentId,
        retryCount: phase.retryCount,
        maxPhaseRetries,
      },
    });
    emitLiveEvent('alert.created', correlationId, {
      alertId: alert.id,
      type: 'feature-blocked',
      intentId: phase.intentId,
      severity: 'high',
    });
    return;
  }

  // TR_026 — the orchestrator no longer detects which files the
  // phase wrote. Per ADR-050 that's the phase-evaluator-agent's
  // job: it has `executeScript` in its tools and runs `git diff`
  // itself against the cloned work-dir. The orchestrator's
  // responsibility is to pass the right BRANCH NAMES as context;
  // the agent decides what to do with them.

  // Look up the intent's branchName so the agent can diff it.
  const phaseIntent = phase.intentId
    ? await getRepositories().intents.findById(phase.intentId).catch(() => null)
    : null;

  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential on file`);
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-evaluate-${correlationId}-`));

  try {
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir);
    const repo = simpleGit(workDir);
    try { await repo.checkout(project.defaultBranch); } catch { /* */ }

    // Fetch the phase branch into the clone so `git diff` can see
    // both refs when the agent runs `executeScript`. Best-effort —
    // when auto-merge has squashed and deleted the branch, the
    // agent's git diff against `origin/<defaultBranch>` will simply
    // show the merged commit's diff instead.
    if (phaseIntent?.branchName) {
      await repo.fetch('origin', phaseIntent.branchName).catch(() => undefined);
    }

    let harnessConfig: HarnessConfig | null = null;
    try {
      const snap = await createHarnessEngine(workDir).buildSnapshot(correlationId);
      harnessConfig = snap.harness;
    } catch { /* */ }

    const remaining = (await features.listPhases(feature.id))
      .filter((p) => p.phaseIndex > phase.phaseIndex);

    const evaluation: PhaseEvaluation = await new PhaseEvaluatorAgent().evaluatePhase(
      feature,
      phase,
      {
        defaultBranch: project.defaultBranch,
        phaseBranch: phaseIntent?.branchName ?? null,
        // TR_035 / ADR-057 (Part B2) — the squash-merge SHA populated
        // by the deploy promotion-agent after the phase's PR
        // auto-merged. `null` when the adapter doesn't support
        // auto-merge (NoOpPipelineAdapter) or when the PR closed
        // without going through the promotion-agent path; the
        // phase-evaluator-agent falls back to `git diff
        // origin/<defaultBranch>~1..origin/<defaultBranch>` in
        // that case.
        mergeCommitSha: phase.mergeCommitSha,
      },
      remaining,
      workDir,
      harnessConfig,
      correlationId,
    );

    await features.updatePhaseStatus(phase.id, 'deployed');
    await features.savePhaseResult(phase.id, evaluation);
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-evaluated',
      summary: `Phase ${phase.phaseIndex + 1} evaluated: ${evaluation.verdict}`,
      detail: evaluation as unknown,
    });

    if (evaluation.verdict === 'escalate') {
      childLog.warn(
        { featureId: feature.id, phaseId: phase.id },
        'phase-evaluator-agent escalated — marking feature blocked',
      );
      await features.updateStatus(feature.id, 'blocked');
      return;
    }

    // Apply adjustments to remaining phases (by title match).
    if (evaluation.adjustments.length > 0) {
      for (const adj of evaluation.adjustments) {
        const target = remaining.find((p) => p.title === adj.phaseTitle);
        if (!target) continue;
        const newScope = adj.updatedScope ?? target.scope;
        const newDeps = adj.updatedDependencies ?? target.dependencies;
        // Re-create phase via direct UPDATE through saveArchitecture
        // is overkill; do a minimal patch by re-using createPhase
        // semantics is also wrong. Use a small repository call —
        // expose this via the existing updatePhaseStatus + result
        // pattern. Since the FeatureRepository interface does not
        // include a generic "patch scope" method, we encode the
        // adjustment in the plan log + apply it inline by
        // re-issuing through savePhaseResult on the target phase.
        // The orchestrator reads `result.pendingScopeAdjustment`
        // when building the next phase's intent text.
        await features.savePhaseResult(target.id, {
          pendingScopeAdjustment: {
            updatedScope: newScope,
            updatedDependencies: newDeps,
            reason: adj.reason,
          },
        });
      }
      await features.appendLog({
        featureId: feature.id,
        phaseIndex: phase.phaseIndex,
        eventType: 'plan-adjusted',
        summary: `${evaluation.adjustments.length} adjustment(s) applied to remaining phases`,
        detail: { adjustments: evaluation.adjustments },
      });
    }

    // Always re-emit PLAN.md after a phase deploys so the
    // "What has been built" section reflects what's on disk —
    // even when no scope adjustments were issued. TR_031 — the
    // next phase's Aider reads PLAN.md to know what exists.
    await rewritePlanMd(workDir, feature, repo, project.defaultBranch);

    // Bump current phase + dispatch next, OR mark feature completed.
    const nextIndex = phase.phaseIndex + 1;
    await features.setCurrentPhase(feature.id, nextIndex);

    if (nextIndex >= feature.phaseCount) {
      await features.updateStatus(feature.id, 'completed');
      await features.appendLog({
        featureId: feature.id,
        phaseIndex: null,
        eventType: 'feature-completed',
        summary: `Feature "${feature.title}" completed — ${feature.phaseCount} phase(s) deployed`,
        detail: null,
      });
      childLog.info({ featureId: feature.id }, 'Feature completed');
      return;
    }

    childLog.info(
      { featureId: feature.id, nextIndex },
      'Dispatching next planning:phase',
    );
    await dispatch<PlanningPhasePayload>({
      id: crypto.randomUUID(),
      correlationId,
      type: 'planning:phase',
      sourceAgent: 'orchestrator',
      targetAgent: 'planner-agent',
      priority: 'normal' as TaskPriority,
      payload: { featureId: feature.id, phaseIndex: nextIndex },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, getQueueConfig());
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── PLAN.md + ARCHITECTURE.md helpers ───────────────────────────────

async function writePlanMd(
  workDir: string, feature: FeatureRecord,
  architecture: FeatureArchitecture, plan: FeaturePlan,
): Promise<void> {
  const lines: string[] = [];
  lines.push(`# PLAN.md — ${feature.title}`);
  lines.push('');
  lines.push(`_Generated by Gestalt planning layer (feature ${feature.id.slice(0, 8)})._`);
  lines.push('');
  lines.push('## Feature description');
  lines.push('');
  lines.push(feature.description);
  lines.push('');
  if (architecture.modules.length > 0) {
    lines.push('## Modules');
    for (const m of architecture.modules) {
      lines.push(`- **${m.name}** (\`${m.path}\`) — owns: ${m.owns.join(', ')}`);
    }
    lines.push('');
  }
  if (architecture.domainEntities.length > 0) {
    lines.push('## Domain entities');
    for (const e of architecture.domainEntities) {
      lines.push(`- **${e.name}** — ${e.purpose} (attributes: ${e.attributes.join(', ')})`);
    }
    lines.push('');
  }
  lines.push('## Phases');
  lines.push('');
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i]!;
    lines.push(`### Phase ${i + 1}: ${p.title}`);
    if (p.dependencies.length > 0) {
      lines.push(`_Depends on: ${p.dependencies.join(', ')}_`);
    }
    lines.push('');
    lines.push(p.scope);
    if (p.architecture) {
      lines.push('');
      lines.push('**Architecture:**');
      lines.push(p.architecture);
    }
    lines.push('');
  }
  await writeFile(join(workDir, 'PLAN.md'), lines.join('\n'), 'utf8');
}

async function rewritePlanMd(
  workDir: string,
  feature: FeatureRecord,
  repo: ReturnType<typeof simpleGit>,
  branch: string,
): Promise<void> {
  const { features } = getRepositories();
  const phases = await features.listPhases(feature.id);
  const lines: string[] = [];
  lines.push(`# PLAN.md — ${feature.title}`);
  lines.push('');
  lines.push(`_Adjusted by phase-evaluator-agent at ${new Date().toISOString()}._`);
  lines.push('');
  lines.push('## Phases');
  lines.push('');
  for (const p of phases) {
    const result = p.result as {
      pendingScopeAdjustment?: { updatedScope?: string; reason?: string };
      builtFiles?: Array<{ path: string; exports?: string[] }>;
    } | null;
    const adj = result?.pendingScopeAdjustment;
    lines.push(`### Phase ${p.phaseIndex + 1}: ${p.title} [${p.status}]`);
    if (adj?.reason) {
      lines.push(`_Adjustment: ${adj.reason}_`);
    }
    lines.push('');
    lines.push(adj?.updatedScope ?? p.scope);
    lines.push('');
    if (p.status === 'deployed' && Array.isArray(result?.builtFiles) && result.builtFiles.length > 0) {
      lines.push('**What has been built:**');
      for (const f of result.builtFiles) {
        const path = (f.path ?? '').trim();
        if (!path) continue;
        if (Array.isArray(f.exports) && f.exports.length > 0) {
          lines.push(`- \`${path}\` — ${f.exports.map((e) => `\`${e}\``).join(', ')}`);
        } else {
          lines.push(`- \`${path}\``);
        }
      }
      lines.push('');
    }
  }
  await writeFile(join(workDir, 'PLAN.md'), lines.join('\n'), 'utf8');
  await commitAndPush(repo, branch, `chore(planning): adjust PLAN.md after phase evaluation [gestalt-planning]`);
}

async function maybeAppendArchitectureMd(
  workDir: string,
  architecture: FeatureArchitecture,
): Promise<void> {
  const update = architecture.architectureMdUpdate.trim();
  if (!update) return;
  const archPath = join(workDir, 'docs/ARCHITECTURE.md');
  if (!(await exists(archPath))) return;
  const existing = await readFileSafe(archPath);
  // Append only — never replace existing content (additive guard).
  const next = existing.endsWith('\n') ? existing + '\n' + update + '\n' : existing + '\n\n' + update + '\n';
  await writeFile(archPath, next, 'utf8');
}

async function commitAndPush(
  repo: ReturnType<typeof simpleGit>,
  branch: string,
  message: string,
): Promise<void> {
  await repo.add(['PLAN.md', 'docs/ARCHITECTURE.md']);
  const status = await repo.status();
  if (status.files.length === 0) return;
  await repo.addConfig('user.name', 'Gestalt Planning');
  await repo.addConfig('user.email', 'planning@gestalt.local');
  await repo.commit(message);
  try {
    await repo.push('origin', branch);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'planning push failed — continuing');
  }
}

function boundsFromHarness(
  harnessConfig: HarnessConfig | null,
): { maxPhases: number; maxFilesPerPhase: number } {
  const p = harnessConfig?.planner;
  if (!p?.enabled) {
    return { maxPhases: DEFAULT_MAX_PHASES, maxFilesPerPhase: DEFAULT_MAX_FILES_PER_PHASE };
  }
  return {
    maxPhases: Math.max(1, Math.min(50, p.maxPhasesPerFeature || DEFAULT_MAX_PHASES)),
    maxFilesPerPhase: Math.max(1, Math.min(50, p.maxFilesPerPhase || DEFAULT_MAX_FILES_PER_PHASE)),
  };
}

/**
 * TR_022 — read `planner.maxPhaseRetries` from the project's
 * HARNESS.json. Quick shallow clone + JSON parse (no full harness
 * snapshot needed for a single field). On ANY failure path returns
 * `DEFAULT_MAX_PHASE_RETRIES` — the retry budget should never
 * silently disappear because of a parse hiccup. Validates the
 * value is a non-negative integer ≤ 10 before returning it.
 */
async function readMaxPhaseRetries(
  project: { gitUrl: string; defaultBranch: string; name: string; id: string },
  correlationId: string,
  childLog: ReturnType<typeof createContextLogger>,
): Promise<number> {
  const token = await resolveProjectCredential(project as Parameters<typeof resolveProjectCredential>[0]);
  if (!token) return DEFAULT_MAX_PHASE_RETRIES;

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-retries-${correlationId}-`));
  try {
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir, ['--depth=1']);
    const raw = await readFile(join(workDir, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as { planner?: { maxPhaseRetries?: number } };
    const value = parsed.planner?.maxPhaseRetries;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return DEFAULT_MAX_PHASE_RETRIES;
    }
    return Math.min(10, Math.floor(value));
  } catch (err) {
    childLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'readMaxPhaseRetries fell back to default',
    );
    return DEFAULT_MAX_PHASE_RETRIES;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
