/**
 * PlanningGraph nodes (TR_053 / ADR-056 Phase 2).
 *
 * Each node clones the project repository, runs its slice of the
 * planning loop, persists results via the platform repositories,
 * and returns a `Partial<state>` for LangGraph's reducer to merge.
 *
 * Shared concerns:
 *   - Repo cloning happens inside the node (per call) because the
 *     graph runs across multiple BullMQ jobs separated by
 *     `interrupt()` boundaries; there is no persistent workspace.
 *   - HarnessConfig + golden principles are re-read inside the node
 *     for the same reason.
 *   - DB writes (`features`, `feature_phases`, `feature_plan_log`)
 *     mirror the legacy orchestrator one-for-one so the dashboard,
 *     CLI, and event bus see identical observable state regardless
 *     of which path produced the data.
 *   - `interrupt()` is used in `awaitPhaseNode` and `humanFeedbackNode`
 *     to suspend the graph. The BullMQ worker that hosts the call
 *     returns immediately; the state is checkpointed to PostgreSQL.
 *     Resume happens via `graph.invoke(new Command({resume: value}))`
 *     fired by a separate BullMQ task.
 */

import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import { interrupt } from '@langchain/langgraph';
import {
  getRepositories, getQueueConfig, dispatch,
  createContextLogger, createHarnessEngine,
  resolveProjectCredential, emitLiveEvent,
} from '@gestalt/core';
import type {
  HarnessConfig, FeatureRecord, FeaturePhaseRecord, TaskPriority,
} from '@gestalt/core';
import { runArchitectureGraph } from '../architecture/graph';
import { PlannerAgent } from '../../agents/planner-agent';
import { ArchitectureAgent } from '../../agents/architecture-agent';
import { PhaseEvaluatorAgent } from '../../agents/phase-evaluator-agent';
import { extractCanonicalSqlSchemas } from '../../prompts/architecture-prompt';
import type { FeatureArchitecture, FeaturePlan, PhaseEvaluation } from '../../types';
import type { PlanningGraphStateType } from './state';

const log = createContextLogger({ module: 'planning-graph' });

const DEFAULT_MAX_PHASES = 10;
const DEFAULT_MAX_FILES_PER_PHASE = 5;
const DEFAULT_MAX_PHASE_RETRIES = 2;

// ─── Shared helpers (kept local to the graph) ────────────────────────

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
  try { await access(path); return true; } catch { return false; }
}

interface CloneContext {
  workDir: string;
  harnessConfig: HarnessConfig | null;
  goldenPrinciplesMd: string;
  feature: FeatureRecord;
  projectGitUrl: string;
  projectDefaultBranch: string;
}

async function cloneAndLoad(
  featureId: string,
  correlationId: string,
): Promise<CloneContext> {
  const { features, projects } = getRepositories();
  const feature = await features.findById(featureId);
  if (!feature) throw new Error(`Feature ${featureId} not found`);
  const project = await projects.findById(feature.projectId);
  if (!project) throw new Error(`Project ${feature.projectId} not found`);
  const token = await resolveProjectCredential(project);
  if (!token) throw new Error(`Project ${project.name} has no Git credential on file`);

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-planning-graph-${correlationId}-`));
  const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
  await simpleGit().clone(cloneUrl, workDir);
  const repo = simpleGit(workDir);
  try { await repo.checkout(project.defaultBranch); } catch { /* brand-new repo */ }

  let harnessConfig: HarnessConfig | null = null;
  try {
    const snap = await createHarnessEngine(workDir).buildSnapshot(correlationId);
    harnessConfig = snap.harness;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), featureId },
      'planning-graph could not read HARNESS.json — proceeding without project rules',
    );
  }
  const goldenPrinciplesMd = await readFileSafe(join(workDir, 'docs/GOLDEN_PRINCIPLES.md'));
  return {
    workDir,
    harnessConfig,
    goldenPrinciplesMd,
    feature,
    projectGitUrl: project.gitUrl,
    projectDefaultBranch: project.defaultBranch,
  };
}

function boundsFromHarness(harnessConfig: HarnessConfig | null): {
  maxPhases: number; maxFilesPerPhase: number;
} {
  const p = harnessConfig?.planner;
  if (!p?.enabled) {
    return {
      maxPhases: DEFAULT_MAX_PHASES,
      maxFilesPerPhase: DEFAULT_MAX_FILES_PER_PHASE,
    };
  }
  return {
    maxPhases: Math.max(1, Math.min(50, p.maxPhasesPerFeature || DEFAULT_MAX_PHASES)),
    maxFilesPerPhase: Math.max(1, Math.min(50, p.maxFilesPerPhase || DEFAULT_MAX_FILES_PER_PHASE)),
  };
}

function maxRetriesFromHarness(harnessConfig: HarnessConfig | null): number {
  const v = harnessConfig?.planner?.maxPhaseRetries;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    return DEFAULT_MAX_PHASE_RETRIES;
  }
  return Math.min(10, Math.floor(v));
}

// ─── Node 1: architectureNode ────────────────────────────────────────

export async function architectureNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  const ctx = await cloneAndLoad(state.featureId, state.correlationId);
  try {
    const { features } = getRepositories();
    const archMd = await readFileSafe(join(ctx.workDir, 'docs/ARCHITECTURE.md'));
    log.info(
      { featureId: state.featureId, correlationId: state.correlationId },
      'planning-graph architectureNode invoking ArchitectureGraph',
    );
    const result = await runArchitectureGraph({
      feature: ctx.feature,
      existingArchitectureMd: archMd,
      goldenPrinciplesMd: ctx.goldenPrinciplesMd,
      projectRoot: ctx.workDir,
      harnessConfig: ctx.harnessConfig,
      correlationId: state.correlationId,
    });
    if (result.errors.length > 0) {
      log.warn(
        { featureId: state.featureId, errors: result.errors },
        'ArchitectureGraph completed with specialist errors — chief reconciled',
      );
    }
    const summary = JSON.stringify(result.architecture);

    await features.appendLog({
      featureId: state.featureId,
      phaseIndex: null,
      eventType: 'architecture-designed',
      summary: `Feature architecture: ${result.architecture.modules.length} module(s), ${result.architecture.recommendedPhases.length} recommended phase(s)`,
      detail: result.architecture as unknown,
    });

    // Append architectureMdUpdate to docs/ARCHITECTURE.md if it exists
    const updateText = result.architecture.architectureMdUpdate?.trim() ?? '';
    if (updateText.length > 0) {
      const archPath = join(ctx.workDir, 'docs/ARCHITECTURE.md');
      if (await exists(archPath)) {
        const existing = await readFileSafe(archPath);
        const next = existing.endsWith('\n')
          ? existing + '\n' + updateText + '\n'
          : existing + '\n\n' + updateText + '\n';
        await writeFile(archPath, next, 'utf8');
      }
    }

    return {
      featureArchitecture: summary,
      tokensUsed: result.tokensUsed,
    };
  } finally {
    await rm(ctx.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── Node 2: plannerNode ─────────────────────────────────────────────

export async function plannerNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  if (!state.featureArchitecture) {
    return { errors: ['planner: no featureArchitecture in state'], planningAction: 'escalate' };
  }
  const ctx = await cloneAndLoad(state.featureId, state.correlationId);
  try {
    const { features } = getRepositories();
    const architecture = JSON.parse(state.featureArchitecture) as FeatureArchitecture;
    const bounds = boundsFromHarness(ctx.harnessConfig);
    log.info({ featureId: state.featureId }, 'planning-graph plannerNode invoking planner-agent');
    const plannerAgent = new PlannerAgent();
    const plan = await plannerAgent.planFeature(
      ctx.feature, architecture, ctx.workDir, ctx.harnessConfig, bounds, state.correlationId,
    );
    if (plan.phases.length === 0) {
      await features.updateStatus(state.featureId, 'blocked');
      await features.appendLog({
        featureId: state.featureId,
        phaseIndex: null,
        eventType: 'plan-empty',
        summary: 'planner-agent returned zero phases',
        detail: null,
      });
      return {
        errors: ['planner: returned zero phases'],
        planningAction: 'escalate',
        tokensUsed: plannerAgent.lastTokensUsed,
      };
    }
    const summary = JSON.stringify(architecture, null, 2);
    await features.saveArchitectureAndPlan(state.featureId, {
      architecture: summary,
      phaseCount: plan.phases.length,
    });
    for (let i = 0; i < plan.phases.length; i++) {
      const p = plan.phases[i]!;
      await features.createPhase({
        id: crypto.randomUUID(),
        featureId: state.featureId,
        phaseIndex: i,
        title: p.title,
        scope: p.scope,
        architecture: p.architecture ?? null,
        dependencies: p.dependencies,
      });
    }
    await features.appendLog({
      featureId: state.featureId,
      phaseIndex: null,
      eventType: 'plan-built',
      summary: `Plan built: ${plan.phases.length} phase(s)`,
      detail: { phases: plan.phases.map((p) => p.title) },
    });
    emitLiveEvent('intent.status-changed', state.correlationId, {
      featureId: state.featureId, status: 'planning-complete',
    });
    return {
      phasesJson: JSON.stringify(plan),
      tokensUsed: plannerAgent.lastTokensUsed,
    };
  } finally {
    await rm(ctx.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── Node 3: phaseDispatchNode ───────────────────────────────────────
//
// TR_053 amendment Fix 6 — side-effect surface:
//   This node creates an intent row, writes `feature_phases.intent_id`,
//   and dispatches a BullMQ job. It is INTENTIONALLY separate from
//   `awaitPhaseNode` so the intent is created exactly once per
//   `phase-dispatch → await-phase` transition. The next node
//   (`awaitPhaseNode`) is the interrupt point; on resume, only that
//   node re-runs, so dispatchNode's side effects don't replay.
//
//   Tradeoff (documented; TR_054 follow-up): if the worker crashes
//   MID-NODE (between intent.create and queue.dispatch), restart
//   would re-run this node from the top and create a second intent.
//   That's a narrow window (a few ms of DB writes); the verified
//   server-restart-while-parked scenario (the primary failure mode
//   the migration targets) is parked at awaitPhaseNode, not in
//   phaseDispatchNode. Crash-mid-node idempotency (e.g. check
//   feature_phases.intent_id at top + reuse if set + reachable) is a
//   targeted improvement we'll add if it ever surfaces in practice.

export async function phaseDispatchNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  if (!state.phasesJson) {
    return { errors: ['phase-dispatch: no plan in state'], planningAction: 'escalate' };
  }
  const plan = JSON.parse(state.phasesJson) as FeaturePlan;
  if (state.currentPhaseIndex >= plan.phases.length) {
    return { planningAction: 'complete' };
  }
  const ctx = await cloneAndLoad(state.featureId, state.correlationId);
  try {
    const { features, intents } = getRepositories();
    const phase = await features.findPhaseByIndex(state.featureId, state.currentPhaseIndex);
    if (!phase) {
      return { errors: [`phase-dispatch: phase ${state.currentPhaseIndex} not found`], planningAction: 'escalate' };
    }

    // Per-phase architecture pass — same logic as the legacy orchestrator
    // when `architectureReviewPerPhase` is on.
    let phaseArchitectureUpdate: string | null = null;
    if (ctx.harnessConfig?.planner?.architectureReviewPerPhase === true) {
      try {
        const priorPhases = (await features.listPhases(state.featureId))
          .filter((p) => p.phaseIndex < phase.phaseIndex);
        const canonicalSqlSchemas = extractCanonicalSqlSchemas(ctx.feature.architecture);
        const architectureAgent = new ArchitectureAgent();
        const draftPa = await architectureAgent.designPhase(
          ctx.feature, phase.title, phase.architecture ?? phase.scope,
          ctx.feature.architecture ?? '', priorPhases, ctx.workDir,
          ctx.harnessConfig, state.correlationId, ctx.goldenPrinciplesMd,
          canonicalSqlSchemas,
        );
        const reviewedPa = await architectureAgent.reviewPhaseDesign(
          draftPa, phase, ctx.feature, ctx.workDir, ctx.harnessConfig,
          state.correlationId, ctx.goldenPrinciplesMd, canonicalSqlSchemas,
        );
        phaseArchitectureUpdate = JSON.stringify(reviewedPa);
        await features.updatePhaseArchitecture(phase.id, phaseArchitectureUpdate);
        await features.appendLog({
          featureId: state.featureId,
          phaseIndex: phase.phaseIndex,
          eventType: 'phase-architecture-designed',
          summary: `Phase ${phase.phaseIndex + 1} architecture: ${reviewedPa.interfaces.length} interface(s), ${reviewedPa.successCriteria.length} criteria`,
          detail: reviewedPa as unknown,
        });
      } catch (err) {
        log.warn({ err }, 'per-phase architecture pass failed — proceeding without it');
      }
    }

    // Collect deferred-to-later phases (TR_039) for the intent text.
    const allPhases = await features.listPhases(state.featureId);
    const laterPhases = allPhases.filter(
      (p) => p.phaseIndex > phase.phaseIndex && p.status === 'pending',
    );

    const intentText = buildPhaseIntentText(ctx.feature, phase, phaseArchitectureUpdate, laterPhases);
    const newCorrelationId = crypto.randomUUID();
    // TR_053 amendment — stamp the parent-context envelope on the
    // intent at create time so `transitionIntent` (deploy) can
    // surface featureId + phaseIndex inside the
    // `intent.status-changed` event payload. The planning subscriber
    // then routes the resume signal without a downstream JOIN.
    const intent = await intents.create({
      id: crypto.randomUUID(),
      correlationId: newCorrelationId,
      projectId: ctx.feature.projectId,
      text: intentText,
      status: 'pending',
      source: 'human',
      priority: 'normal',
      parentContext: {
        kind: 'planning-phase',
        featureId: state.featureId,
        phaseIndex: phase.phaseIndex,
      },
    });
    await features.updatePhaseIntent(phase.id, intent.id);
    await features.appendLog({
      featureId: state.featureId,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-submitted',
      summary: `Phase ${phase.phaseIndex + 1}/${ctx.feature.phaseCount}: ${phase.title} — intent ${intent.id.slice(0, 8)}`,
      detail: { intentId: intent.id, correlationId: newCorrelationId },
    });
    await intents.updateStatus(intent.id, 'generating');
    emitLiveEvent('intent.created', newCorrelationId, {
      intentId: intent.id, text: intentText, priority: 'normal',
      featureId: state.featureId, phaseIndex: phase.phaseIndex,
    });
    await dispatch({
      id: crypto.randomUUID(),
      correlationId: newCorrelationId,
      type: 'generate:intent',
      sourceAgent: 'orchestrator',
      targetAgent: 'intent-agent',
      priority: 'normal' as TaskPriority,
      payload: { intentId: intent.id, text: intentText, projectId: ctx.feature.projectId },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, getQueueConfig());
    return { currentIntentId: intent.id };
  } finally {
    await rm(ctx.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildPhaseIntentText(
  feature: FeatureRecord,
  phase: FeaturePhaseRecord,
  perPhaseArchitecture: string | null,
  laterPhases: FeaturePhaseRecord[],
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
  if (laterPhases.length > 0) {
    parts.push('');
    parts.push('## Deferred to later phases');
    parts.push(
      'The following concerns are intentionally OUT OF SCOPE for ' +
      'this phase and will be addressed in subsequent phases:',
    );
    for (const p of laterPhases) {
      const scopeSnippet = p.scope.replace(/\s+/g, ' ').trim().slice(0, 100);
      parts.push(`- Phase ${p.phaseIndex + 1} — ${p.title}: ${scopeSnippet}`);
    }
  }
  return parts.join('\n');
}

// ─── Node 4: awaitPhaseNode (LangGraph interrupt) ────────────────────
//
// TR_053 amendment Fix 6 — interrupt-node rule:
//   When the graph resumes via `Command({resume})`, LangGraph
//   RE-EXECUTES this node from the top up to the `interrupt()` call
//   (interrupt is a checkpoint, not a skip-forward). So any DB
//   write, SSE emit, BullMQ dispatch, or other side-effectful work
//   placed before `interrupt()` will be PERFORMED TWICE — once on
//   the initial run, once on resume.
//
//   Rule for this file: an interrupt node contains ONLY
//   structured log + `interrupt(...)`. Side effects belong in the
//   upstream node that decided to enter this state.

export async function awaitPhaseNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  // Side-effect-safe: a structured log is idempotent (no DB write,
  // no event emit). Everything else is the `interrupt()` call.
  log.info(
    {
      featureId: state.featureId,
      phaseIndex: state.currentPhaseIndex,
      intentId: state.currentIntentId,
    },
    'planning-graph awaitPhaseNode interrupting — waiting for intent to deploy',
  );
  const resumeValue = interrupt({
    type: 'await-intent',
    featureId: state.featureId,
    phaseIndex: state.currentPhaseIndex,
    intentId: state.currentIntentId,
  }) as {
    success?: boolean;
    mergeCommitSha?: string | null;
    failureReason?: string;
  };
  return { phaseResult: JSON.stringify(resumeValue ?? { success: false }) };
}

// ─── Node 5: phaseEvaluatorNode ──────────────────────────────────────

export async function phaseEvaluatorNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  if (!state.phaseResult) {
    return { errors: ['phase-evaluator: no phaseResult in state'], planningAction: 'escalate' };
  }
  const result = JSON.parse(state.phaseResult) as {
    success?: boolean;
    mergeCommitSha?: string | null;
    failureReason?: string;
  };

  const ctx = await cloneAndLoad(state.featureId, state.correlationId);
  try {
    const { features } = getRepositories();
    const phase = await features.findPhaseByIndex(state.featureId, state.currentPhaseIndex);
    if (!phase) {
      return { errors: [`phase-evaluator: phase ${state.currentPhaseIndex} not found`], planningAction: 'escalate' };
    }

    if (!result.success) {
      // Phase failed — honour the retry budget.
      const maxRetries = maxRetriesFromHarness(ctx.harnessConfig);
      if (state.currentPhaseRetries < maxRetries) {
        await features.appendLog({
          featureId: state.featureId,
          phaseIndex: phase.phaseIndex,
          eventType: 'phase-retry',
          summary: `Phase ${phase.phaseIndex + 1} (${phase.title}) failed — retry ${state.currentPhaseRetries + 1}/${maxRetries}`,
          detail: { retryCount: state.currentPhaseRetries + 1, maxRetries },
        });
        return {
          planningAction: 'adjust',
          currentPhaseRetries: state.currentPhaseRetries + 1,
          phaseResult: null,
          currentIntentId: null,
        };
      }
      await features.updatePhaseStatus(phase.id, 'failed');
      await features.updateStatus(state.featureId, 'blocked');
      await features.appendLog({
        featureId: state.featureId,
        phaseIndex: phase.phaseIndex,
        eventType: 'phase-failed',
        summary: `Phase ${phase.phaseIndex + 1} (${phase.title}) failed after ${maxRetries} retries — feature blocked`,
        detail: { retryCount: state.currentPhaseRetries, maxRetries },
      });
      return { planningAction: 'escalate' };
    }

    // Phase succeeded — run phase-evaluator-agent to decide next.
    const remaining = (await features.listPhases(state.featureId))
      .filter((p) => p.phaseIndex > phase.phaseIndex);
    const phaseIntent = phase.intentId
      ? await getRepositories().intents.findById(phase.intentId).catch(() => null)
      : null;

    const evaluator = new PhaseEvaluatorAgent();
    const evaluation: PhaseEvaluation = await evaluator.evaluatePhase(
      ctx.feature, phase,
      {
        defaultBranch: ctx.projectDefaultBranch,
        phaseBranch: phaseIntent?.branchName ?? null,
        mergeCommitSha: result.mergeCommitSha ?? phase.mergeCommitSha,
      },
      remaining,
      ctx.workDir,
      ctx.harnessConfig,
      state.correlationId,
    );

    await features.updatePhaseStatus(phase.id, 'deployed');
    await features.savePhaseResult(phase.id, evaluation);
    await features.appendLog({
      featureId: state.featureId,
      phaseIndex: phase.phaseIndex,
      eventType: 'phase-evaluated',
      summary: `Phase ${phase.phaseIndex + 1} evaluated: ${evaluation.verdict}`,
      detail: evaluation as unknown,
    });

    // TR_053 amendment Fix 7 — adjust/continue/escalate semantics.
    //
    //   continue: current phase succeeded with NO adjustments to
    //             remaining phases. Advance `currentPhaseIndex`,
    //             reuse the persisted plan as-is.
    //
    //   adjust:   current phase succeeded but the evaluator rewrote
    //             the scope/dependencies of one or more REMAINING
    //             phases (index+1 onward — the just-completed phase
    //             is never re-dispatched). Advance
    //             `currentPhaseIndex` and continue with the adjusted
    //             plan. Both `continue` and `adjust` route to
    //             `phase-dispatch`; the distinction is observability
    //             (the log + `planningAction` value) — control flow
    //             is identical.
    //
    //   escalate: current phase failed terminally OR evaluator
    //             chose to escalate. Do NOT advance the index. Route
    //             to `human-feedback`. The deciding-node (this one)
    //             also emits the `feature-blocked` alert exactly
    //             once (Fix 6) BEFORE routing.

    // Apply any scope adjustments to remaining phases. Adjustments
    // only touch `pendingScopeAdjustment` on phases with index
    // strictly GREATER than the just-completed phase, so the
    // current-phase index can be safely advanced after this block.
    const hasAdjustments = evaluation.adjustments.length > 0;
    if (hasAdjustments) {
      for (const adj of evaluation.adjustments) {
        const target = remaining.find((p) => p.title === adj.phaseTitle);
        if (!target) continue;
        await features.savePhaseResult(target.id, {
          pendingScopeAdjustment: {
            updatedScope: adj.updatedScope ?? target.scope,
            updatedDependencies: adj.updatedDependencies ?? target.dependencies,
            reason: adj.reason,
          },
        });
      }
      await features.appendLog({
        featureId: state.featureId,
        phaseIndex: phase.phaseIndex,
        eventType: 'plan-adjusted',
        summary: `${evaluation.adjustments.length} adjustment(s) applied to remaining phases`,
        detail: { adjustments: evaluation.adjustments },
      });
    }

    if (evaluation.verdict === 'escalate') {
      await features.updateStatus(state.featureId, 'blocked');
      // TR_053 amendment Fix 6 — emit the feature-blocked alert
      // HERE (in the deciding node) rather than inside
      // `humanFeedbackNode`. The interrupt node re-runs on every
      // resume, so any DB write or SSE event placed before its
      // `interrupt()` call would duplicate. The evaluator runs
      // once per phase outcome and is the right home for the
      // alert.
      try {
        const { alerts } = getRepositories();
        const alert = await alerts.create({
          correlationId: state.correlationId,
          intentId: state.currentIntentId ?? null,
          type: 'feature-blocked',
          severity: 'high',
          title: `Feature blocked at phase ${state.currentPhaseIndex + 1}`,
          description:
            `PlanningGraph escalated at phase ${state.currentPhaseIndex + 1}. ` +
            (state.errors.length > 0 ? `Reasons: ${state.errors.join('; ')}. ` : '') +
            'Human review required to resume.',
          requiredAction: 'review-manually',
          context: {
            featureId: state.featureId,
            phaseId: phase.id,
            phaseIndex: state.currentPhaseIndex,
            phaseTitle: phase.title,
            intentId: state.currentIntentId,
            errors: state.errors,
            source: 'planning-graph',
          },
        });
        emitLiveEvent('alert.created', state.correlationId, {
          alertId: alert.id,
          type: 'feature-blocked',
          intentId: state.currentIntentId ?? null,
          severity: 'high',
        });
      } catch (err) {
        log.warn({ err }, 'phaseEvaluatorNode failed to create blocking alert');
      }
      return { planningAction: 'escalate', tokensUsed: evaluator.lastTokensUsed };
    }

    const plan = JSON.parse(state.phasesJson!) as FeaturePlan;
    const nextIndex = state.currentPhaseIndex + 1;
    await features.setCurrentPhase(state.featureId, nextIndex);

    if (nextIndex >= plan.phases.length) {
      await features.updateStatus(state.featureId, 'completed');
      await features.appendLog({
        featureId: state.featureId,
        phaseIndex: null,
        eventType: 'feature-completed',
        summary: `Feature "${ctx.feature.title}" completed — ${plan.phases.length} phase(s) deployed`,
        detail: null,
      });
      return { planningAction: 'complete', tokensUsed: evaluator.lastTokensUsed };
    }

    return {
      // 'adjust' when adjustments were applied this evaluation;
      // 'continue' otherwise. Both advance the index; the
      // distinction is observability-only.
      planningAction: hasAdjustments ? 'adjust' : 'continue',
      currentPhaseIndex: nextIndex,
      currentPhaseRetries: 0,
      phaseResult: null,
      currentIntentId: null,
      tokensUsed: evaluator.lastTokensUsed,
    };
  } finally {
    await rm(ctx.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── Node 6: humanFeedbackNode (LangGraph interrupt) ─────────────────
//
// TR_053 amendment Fix 6 — interrupt-node rule:
//   This node RE-EXECUTES on resume. Side effects belong upstream
//   (the `phaseEvaluatorNode` 'escalate' branch creates the
//   feature-blocked alert — it runs exactly once per phase
//   outcome). This node is reduced to log + interrupt only.

export async function humanFeedbackNode(
  state: PlanningGraphStateType,
): Promise<Partial<PlanningGraphStateType>> {
  // Side-effect-safe: a structured log is idempotent.
  log.warn(
    {
      featureId: state.featureId,
      phaseIndex: state.currentPhaseIndex,
      errors: state.errors,
    },
    'planning-graph humanFeedbackNode interrupting — feature blocked pending human review',
  );
  const feedback = interrupt({
    type: 'human-feedback',
    featureId: state.featureId,
    phaseIndex: state.currentPhaseIndex,
    reason: state.errors.join('; '),
  });
  return {
    humanFeedback: typeof feedback === 'string' ? feedback : JSON.stringify(feedback),
  };
}
