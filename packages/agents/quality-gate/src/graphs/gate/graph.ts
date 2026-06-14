/**
 * GateGraph — LangGraph StateGraph (TR_056 Part 2b / ADR-056 Phase 4).
 *
 * Replaces the gate-orchestrator's per-task verdict-dispatch tail
 * with a graph that owns the routing:
 *
 *   START
 *     ↓
 *   gate              (verdict producer — see ./nodes.ts)
 *     ↓
 *   conditional edges on gateVerdict.verdict:
 *     pass     → END
 *     fail     → self-healing
 *     escalate → self-healing   (GP_BREACH alert already created in gate per TR_053 Fix 6)
 *
 *   self-healing      (shared wrapper — see ../shared/self-healing-node.ts)
 *     ↓
 *   conditional edges on selfHealingOutcome:
 *     retried      → END   (loop dispatched BullMQ — legacy transport bridge;
 *                            new gate task lands → new graph thread.
 *                            TODO(TR_056 generate session): replace with
 *                            `Command({goto: 'generate-entry'})`.)
 *     pendingFix   → END   (B-i: child fix-intent dispatched via existing
 *                            TR_024 mechanism; parent parked at
 *                            waiting-for-clarification; resume via
 *                            onSuccessDispatch fires a fresh generate
 *                            cycle which re-enters gate as a NEW graph
 *                            thread. TODO(TR_054 verified): convert to
 *                            B-ii — interrupt parent + event-bus resume.)
 *     autoResolved → END   (loop's auto-resolver dispatched a fresh cycle)
 *     escalated    → human-feedback
 *     noop         → END
 *
 *   human-feedback ←── LangGraph interrupt()
 *     ↓ (after resume — no subscriber wired this session;
 *        in-place placeholder for the 2c session when handleGateTask
 *        is refactored and an event-bus subscriber is wired)
 *   END
 *
 * One graph thread per gate task. `thread_id = correlationId`.
 *
 * The graph runs inside the existing BullMQ gate worker. For Part 2b
 * the worker DOES NOT call `runGateGraph` yet — that wiring lands in
 * Part 2c. This file only stands the graph up so it compiles and can
 * be exercised by the §5 forced-failure suite in isolation.
 *
 * Interrupt-detection / resume contract mirrors the planning graph
 * (TR_053 amendment Fix 1):
 *   - `Command({resume})` is the resume API in `@langchain/langgraph@0.2.74`.
 *     Plain `graph.invoke(state)` would NOT resume an interrupt — it
 *     would re-enter from START.
 *   - Interrupt detection reads `state.tasks[*].interrupts` and/or
 *     `state.next` non-empty. NOT `result.__interrupt__` (that key is
 *     not surfaced on the invoke return value).
 *
 * Part 2b wrinkle vs planning graph (worth flagging — see report at
 * bottom): planning has the architecture-subgraph "function-call vs
 * subgraph" tradeoff (Fix 8). Gate has no nested subgraph — the
 * selfHealingNode is in-process, B-i. So the planning graph's
 * thread-id-collision concern doesn't apply here.
 */

import { StateGraph, START, END, Command, interrupt } from '@langchain/langgraph';
import { createContextLogger, getCheckpointer } from '@gestalt/core';
import { GateGraphState } from './state';
import type { GateGraphStateType, GateArtifactJson } from './state';
import { gateNode } from './nodes';
import { selfHealingGateNode } from '../shared/self-healing-node';

const log = createContextLogger({ module: 'gate-graph' });

let cachedGraph: ReturnType<typeof compileGraph> | null = null;

/**
 * Minimal humanFeedbackNode for the gate graph. Per TR_053 Fix 6:
 * interrupt nodes contain ONLY log + `interrupt(...)`. No DB writes,
 * no event emits before the interrupt call — LangGraph re-executes
 * any node from the top on resume, so side effects would double up.
 *
 * The GP_BREACH alert is created upstream by `gateNode` on
 * `verdict === 'escalate'`; the self-healing alert is created by the
 * loop's `escalateToHuman`. By the time this node runs, the
 * operator-facing surface is already in place.
 *
 * No event-bus subscriber is wired this session to fire the resume,
 * so reaching this node parks the graph until either (a) a future
 * 2c session adds the resume signal, or (b) the thread is dropped
 * when the cleanup window expires. Acceptable during the transition
 * because the legacy `handleGateTask` is still the live path.
 */
async function humanFeedbackNode(
  state: GateGraphStateType,
): Promise<Partial<GateGraphStateType>> {
  log.info(
    {
      intentId: state.intentId,
      correlationId: state.correlationId,
      outcome: state.selfHealingOutcome,
    },
    'gate-graph humanFeedbackNode interrupting — awaiting operator clarification',
  );
  // Fix-6 rule: NO side effects before the interrupt call.
  interrupt({
    type: 'human-feedback',
    layer: 'gate',
    intentId: state.intentId,
    correlationId: state.correlationId,
    outcome: state.selfHealingOutcome,
  });
  return {};
}

function compileGraph(checkpointer: Awaited<ReturnType<typeof getCheckpointer>>) {
  const workflow = new StateGraph(GateGraphState)
    .addNode('gate', gateNode)
    .addNode('self-healing', selfHealingGateNode)
    .addNode('human-feedback', humanFeedbackNode)
    .addEdge(START, 'gate')
    .addConditionalEdges(
      'gate',
      (state: GateGraphStateType): string => {
        const verdict = state.gateVerdict?.verdict;
        switch (verdict) {
          case 'pass':     return END;
          case 'fail':     return 'self-healing';
          case 'escalate': return 'self-healing';
          default:
            // No verdict surface (gateNode threw and the synthetic
            // fail emit also went sideways). Route to self-healing
            // so the loop's escalation path can surface an alert.
            return 'self-healing';
        }
      },
      {
        'self-healing': 'self-healing',
        [END]: END,
      },
    )
    .addConditionalEdges(
      'self-healing',
      (state: GateGraphStateType): string => {
        switch (state.selfHealingOutcome) {
          case 'retried':      return END;
          case 'pendingFix':   return END;
          case 'autoResolved': return END;
          case 'escalated':    return 'human-feedback';
          case 'noop':         return END;
          default:             return END;
        }
      },
      {
        'human-feedback': 'human-feedback',
        [END]: END,
      },
    )
    .addEdge('human-feedback', END);

  return workflow.compile({ checkpointer });
}

/**
 * Initial-state shape for a `mode: 'start'` invocation. Mirrors the
 * fields the worker would build from a `GateTaskPayload` after the
 * Part 2c thin-invoker refactor lands.
 */
export interface RunGateGraphStartInput {
  mode: 'start';
  correlationId: string;
  intentId: string;
  projectId?: string | null;
  intentText?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  ciRunId?: string | null;
  readFromBranch: boolean;
  artifacts: GateArtifactJson[];
  retryCount?: number;
}

export interface RunGateGraphResumeInput {
  mode: 'resume';
  correlationId: string;
  /**
   * Free-form payload handed back to whichever interrupt() is being
   * resumed. Today the only interrupt is humanFeedbackNode — payload
   * shape mirrors the planning graph's resume value (operator
   * feedback string, plus optional structured fields a future
   * resume subscriber may add).
   */
  resumeValue: {
    feedback?: string;
    decision?: 'retry' | 'escalate' | 'drop';
  } | string;
}

export type RunGateGraphInput =
  | RunGateGraphStartInput
  | RunGateGraphResumeInput;

export interface RunGateGraphResult {
  /** Verdict the `gateNode` produced (null when the graph never reached it). */
  verdict: 'pass' | 'fail' | 'escalate' | null;
  /** SelfHealing outcome (null when fail/escalate didn't route through self-healing). */
  selfHealingOutcome: GateGraphStateType['selfHealingOutcome'];
  /** True when the graph reached END. */
  reachedEnd: boolean;
  /** True when the graph paused at an interrupt — caller can move on. */
  interrupted: boolean;
  errors: string[];
}

/**
 * Drive the gate graph for one gate task. For Part 2b this is NOT
 * called from `handleGateTask` — the wiring lands in Part 2c. The
 * function exists so the §5 forced-failure suite (Part 2e) can
 * exercise the graph in isolation.
 *
 * Behaviour by mode:
 *   - `start`  — graph runs from START. May reach END (pass / fail
 *     → retried / fix-intent / autoResolved / noop) or interrupt at
 *     humanFeedbackNode (escalate route).
 *   - `resume` — graph re-enters at the interrupt with `Command({resume})`.
 *
 * NEVER throws: the gate node catches its own errors and emits a
 * synthetic fail verdict; the selfHealingNode wraps
 * `runSelfHealingLoop` which has its own never-throws guarantee.
 * Any unexpected throw at the LangGraph layer is caught here and
 * surfaced via `result.errors`.
 */
export async function runGateGraph(
  input: RunGateGraphInput,
): Promise<RunGateGraphResult> {
  const checkpointer = await getCheckpointer();
  if (!cachedGraph) {
    cachedGraph = compileGraph(checkpointer);
    log.info('GateGraph compiled and cached');
  }
  const graph = cachedGraph;
  const config = { configurable: { thread_id: input.correlationId } };

  log.info(
    { correlationId: input.correlationId, mode: input.mode },
    'Invoking GateGraph',
  );

  let finalState: GateGraphStateType;
  try {
    if (input.mode === 'start') {
      const initial: Partial<GateGraphStateType> = {
        intentId: input.intentId,
        correlationId: input.correlationId,
        projectId: input.projectId ?? null,
        intentText: input.intentText ?? null,
        branch: input.branch ?? null,
        prNumber: input.prNumber ?? null,
        prUrl: input.prUrl ?? null,
        ciRunId: input.ciRunId ?? null,
        readFromBranch: input.readFromBranch,
        artifacts: input.artifacts,
        retryCount: input.retryCount ?? 0,
      };
      finalState = (await graph.invoke(initial, config)) as GateGraphStateType;
    } else {
      // TR_053 amendment Fix 1 — Command({resume}) is the resume API.
      // Plain graph.invoke(state, config) would re-enter from START.
      finalState = (await graph.invoke(
        new Command({ resume: input.resumeValue }),
        config,
      )) as GateGraphStateType;
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), correlationId: input.correlationId },
      'GateGraph invocation threw',
    );
    return {
      verdict: null,
      selfHealingOutcome: null,
      reachedEnd: false,
      interrupted: false,
      errors: [`graph-invoke: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // TR_053 amendment Fix 1 — interrupt detection.
  //
  // `state.tasks[*].interrupts[*]` populated AND/OR `state.next`
  // non-empty when the graph is paused at an interrupt. When it
  // reaches END, both are empty. NOT `result.__interrupt__` (not
  // surfaced on the invoke return value in @langchain/langgraph@0.2.74).
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
      { err: err instanceof Error ? err.message : String(err), correlationId: input.correlationId },
      'GateGraph getState() failed — assuming not interrupted',
    );
  }

  const verdict = finalState.gateVerdict?.verdict ?? null;
  const reachedEnd = !interrupted;

  log.info(
    {
      correlationId: input.correlationId,
      mode: input.mode,
      verdict,
      selfHealingOutcome: finalState.selfHealingOutcome,
      interrupted,
      reachedEnd,
      errorCount: finalState.errors?.length ?? 0,
    },
    'GateGraph step complete',
  );

  return {
    verdict,
    selfHealingOutcome: finalState.selfHealingOutcome,
    reachedEnd,
    interrupted,
    errors: finalState.errors ?? [],
  };
}
