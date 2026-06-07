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
  eventBus.subscribe(async (event) => {
    if (event.type !== 'intent.status-changed') return;
    const payload = event.payload as { intentId?: string; status?: string };
    const intentId = payload?.intentId;
    const status = payload?.status;
    if (!intentId || !status) return;
    if (status !== 'deployed' && status !== 'failed' && status !== 'escalated') return;
    try {
      const { features } = getRepositories();
      const phase = await features.findPhaseByIntent(intentId);
      if (!phase) return;  // Not a planner-driven intent — ignore.
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
    const architecture = await new ArchitectureAgent().designFeature(
      feature, archMd, workDir, harnessConfig, correlationId,
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
    const summary = JSON.stringify(pa, null, 2);
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
  const { features, projects, artifacts } = getRepositories();
  const feature = await features.findById(payload.featureId);
  if (!feature) throw new Error(`Feature ${payload.featureId} not found`);
  const phase = (await features.listPhases(feature.id)).find((p) => p.id === payload.phaseId);
  if (!phase) throw new Error(`Phase ${payload.phaseId} not found`);
  const project = await projects.findById(feature.projectId);
  if (!project) throw new Error(`Project ${feature.projectId} not found`);

  if (!payload.intentDeployedSuccessfully) {
    childLog.warn(
      { featureId: feature.id, phaseId: phase.id },
      'Phase intent did not deploy — marking phase failed and feature blocked',
    );
    await features.updatePhaseStatus(phase.id, 'failed');
    await features.updateStatus(feature.id, 'blocked');
    await features.appendLog({
      featureId: feature.id,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-failed',
      summary: `Phase ${phase.phaseIndex + 1} (${phase.title}) did not deploy — feature blocked`,
      detail: null,
    });
    return;
  }

  // Phase deployed — fetch the artifact paths from the intent
  // correlation id, then run phase-evaluator-agent.
  let builtFilePaths: string[] = [];
  if (phase.intentId) {
    try {
      const { intents } = getRepositories();
      const intent = await intents.findById(phase.intentId);
      if (intent) {
        const arts = await artifacts.findByCorrelationId(intent.correlationId);
        builtFilePaths = arts.filter((a) => a.type === 'code').map((a) => a.path);
      }
    } catch (err) {
      childLog.warn({ err }, 'Could not fetch artifacts for phase evaluation');
    }
  }

  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential on file`);
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-evaluate-${correlationId}-`));

  try {
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir);
    const repo = simpleGit(workDir);
    try { await repo.checkout(project.defaultBranch); } catch { /* */ }

    let harnessConfig: HarnessConfig | null = null;
    try {
      const snap = await createHarnessEngine(workDir).buildSnapshot(correlationId);
      harnessConfig = snap.harness;
    } catch { /* */ }

    const remaining = (await features.listPhases(feature.id))
      .filter((p) => p.phaseIndex > phase.phaseIndex);

    const evaluation: PhaseEvaluation = await new PhaseEvaluatorAgent().evaluatePhase(
      feature, phase, builtFilePaths, remaining,
      workDir, harnessConfig, correlationId,
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
      // Re-emit PLAN.md to reflect the adjustments.
      await rewritePlanMd(workDir, feature, repo, project.defaultBranch);
    }

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
    const result = p.result as { pendingScopeAdjustment?: { updatedScope?: string; reason?: string } } | null;
    const adj = result?.pendingScopeAdjustment;
    lines.push(`### Phase ${p.phaseIndex + 1}: ${p.title} [${p.status}]`);
    if (adj?.reason) {
      lines.push(`_Adjustment: ${adj.reason}_`);
    }
    lines.push('');
    lines.push(adj?.updatedScope ?? p.scope);
    lines.push('');
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
