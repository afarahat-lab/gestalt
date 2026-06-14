/**
 * PlanningGraph — LangGraph StateGraph (TR_053 / ADR-056 Phase 2).
 *
 * Replaces the legacy `planning-orchestrator` three-task chain
 * (`planning:start` → `planning:phase` → `planning:evaluate`) with
 * a single graph that runs across multiple BullMQ jobs separated
 * by `interrupt()` boundaries.
 *
 *   START
 *     ↓
 *   architecture     (calls ArchitectureGraph subgraph)
 *     ↓
 *   planner          (decomposes into phases)
 *     ↓
 *   phase-dispatch ←─────┐
 *     ↓                  │
 *   await-phase  ◀── interrupt()
 *     ↓
 *   phase-evaluator
 *     ↓
 *   conditional edges:
 *     continue  → phase-dispatch
 *     adjust    → phase-dispatch
 *     complete  → END
 *     escalate  → human-feedback
 *
 *   human-feedback ◀── interrupt()
 *     ↓ (after resume)
 *   phase-dispatch
 *
 * The PostgreSQL checkpointer (`graphs/checkpointer.ts`) keys
 * checkpoints by `thread_id = featureId`. The first invocation
 * (mode='start') runs until the first interrupt and returns; the
 * BullMQ job completes normally. Resume invocations (mode='resume')
 * call `graph.invoke(new Command({resume: value}))` which continues
 * from the interrupt with `value` as the resume payload.
 */

import { StateGraph, START, END, Command } from '@langchain/langgraph';
import { createContextLogger } from '@gestalt/core';
import { PlanningGraphState } from './state';
import type { PlanningGraphStateType } from './state';
import {
  architectureNode, plannerNode,
  phaseDispatchNode, awaitPhaseNode,
  phaseEvaluatorNode, humanFeedbackNode,
} from './nodes';
import { getCheckpointer } from '../checkpointer';

const log = createContextLogger({ module: 'planning-graph' });

let cachedGraph: ReturnType<typeof compileGraph> | null = null;

function compileGraph(checkpointer: Awaited<ReturnType<typeof getCheckpointer>>) {
  const workflow = new StateGraph(PlanningGraphState)
    .addNode('architecture', architectureNode)
    .addNode('planner', plannerNode)
    .addNode('phase-dispatch', phaseDispatchNode)
    .addNode('await-phase', awaitPhaseNode)
    .addNode('phase-evaluator', phaseEvaluatorNode)
    .addNode('human-feedback', humanFeedbackNode)
    .addEdge(START, 'architecture')
    .addEdge('architecture', 'planner')
    .addEdge('planner', 'phase-dispatch')
    .addEdge('phase-dispatch', 'await-phase')
    .addEdge('await-phase', 'phase-evaluator')
    .addConditionalEdges(
      'phase-evaluator',
      (state: PlanningGraphStateType): string => {
        switch (state.planningAction) {
          case 'continue': return 'phase-dispatch';
          case 'adjust':   return 'phase-dispatch';
          case 'complete': return END;
          case 'escalate': return 'human-feedback';
          default:         return END;
        }
      },
      {
        'phase-dispatch': 'phase-dispatch',
        'human-feedback': 'human-feedback',
        [END]: END,
      },
    )
    .addEdge('human-feedback', 'phase-dispatch');

  return workflow.compile({ checkpointer });
}

export interface RunPlanningGraphStartInput {
  mode: 'start';
  featureId: string;
  correlationId: string;
}

export interface RunPlanningGraphResumeInput {
  mode: 'resume';
  featureId: string;
  resumeValue: {
    success: boolean;
    mergeCommitSha?: string | null;
    failureReason?: string;
  } | string;
}

export type RunPlanningGraphInput =
  | RunPlanningGraphStartInput
  | RunPlanningGraphResumeInput;

export interface RunPlanningGraphResult {
  /** Last `planningAction` written by the graph before it returned. */
  planningAction: 'continue' | 'adjust' | 'complete' | 'escalate' | null;
  /** True if the graph completed (END) rather than returning at an interrupt. */
  reachedEnd: boolean;
  /** True if the graph paused at an interrupt — caller can move on. */
  interrupted: boolean;
  errors: string[];
  tokensUsed: number;
}

/**
 * Drive the planning graph for one feature. Caller is the BullMQ
 * planning worker, separately for `mode: 'start'` and `mode: 'resume'`.
 *
 * Behaviour by mode:
 *   - `start`  — graph runs from START. Hits `awaitPhaseNode`'s
 *     interrupt (after architecture + planner + phase-0 dispatch).
 *     Returns with `interrupted: true`. BullMQ job completes
 *     normally; promotion-agent's later resume invocation continues
 *     the graph.
 *   - `resume` — graph re-enters at the interrupt. Runs phase-evaluator,
 *     loops back to phase-dispatch + awaitPhase OR reaches END. May
 *     interrupt again (next phase await) or complete the feature.
 *
 * Errors during graph execution are returned as
 * `result.errors`; the graph itself never throws (specialist nodes
 * catch their own errors and surface via state.errors).
 */
export async function runPlanningGraph(
  input: RunPlanningGraphInput,
): Promise<RunPlanningGraphResult> {
  const checkpointer = await getCheckpointer();
  if (!cachedGraph) {
    cachedGraph = compileGraph(checkpointer);
    log.info('PlanningGraph compiled and cached');
  }
  const graph = cachedGraph;
  const config = { configurable: { thread_id: input.featureId } };

  log.info(
    { featureId: input.featureId, mode: input.mode },
    'Invoking PlanningGraph',
  );

  let finalState: PlanningGraphStateType;
  try {
    if (input.mode === 'start') {
      finalState = (await graph.invoke(
        {
          featureId: input.featureId,
          correlationId: input.correlationId,
        } as Partial<PlanningGraphStateType>,
        config,
      )) as PlanningGraphStateType;
    } else {
      finalState = (await graph.invoke(
        new Command({ resume: input.resumeValue }),
        config,
      )) as PlanningGraphStateType;
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), featureId: input.featureId },
      'PlanningGraph invocation threw',
    );
    return {
      planningAction: null,
      reachedEnd: false,
      interrupted: false,
      errors: [`graph-invoke: ${err instanceof Error ? err.message : String(err)}`],
      tokensUsed: 0,
    };
  }

  // TR_053 amendment — interrupt detection.
  //
  // Earlier draft inspected `finalState.__interrupt__`. The smoke
  // test on @langchain/langgraph@0.2.74 proved that key is NOT set
  // on the value returned from `graph.invoke`. The correct signal
  // is on the checkpointed graph state: `state.tasks[*].interrupts[*]`
  // when paused, AND `state.next` is non-empty (it names the node
  // the graph would run next once resumed). When the graph reaches
  // END both are empty.
  let interrupted = false;
  try {
    const stateAfter = await graph.getState(config);
    const nextNodes = stateAfter.next ?? [];
    const tasksWithInterrupts = (stateAfter.tasks ?? []).filter(
      (t) => Array.isArray(t.interrupts) && t.interrupts.length > 0,
    );
    interrupted = tasksWithInterrupts.length > 0 || nextNodes.length > 0;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), featureId: input.featureId },
      'PlanningGraph getState() failed — assuming not interrupted',
    );
  }
  const action = finalState.planningAction;
  const reachedEnd =
    !interrupted && (action === 'complete' || action === 'escalate');

  log.info(
    {
      featureId: input.featureId,
      mode: input.mode,
      planningAction: action,
      interrupted,
      reachedEnd,
      errorCount: finalState.errors.length,
      tokensUsed: finalState.tokensUsed,
    },
    'PlanningGraph step complete',
  );

  return {
    planningAction: action,
    reachedEnd,
    interrupted,
    errors: finalState.errors,
    tokensUsed: finalState.tokensUsed,
  };
}
