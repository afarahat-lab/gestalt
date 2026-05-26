/**
 * Orchestrator state machine.
 * Defines valid state transitions for the generate layer's intent cycle.
 */

import type { OrchestratorState } from '../types';

export interface StateTransition {
  from: OrchestratorState;
  to: OrchestratorState;
  trigger: string;
}

const VALID_TRANSITIONS: StateTransition[] = [
  { from: 'received',                  to: 'analyzing',                trigger: 'intent_received' },
  { from: 'analyzing',                 to: 'waiting_for_clarification', trigger: 'ambiguity_detected' },
  { from: 'analyzing',                 to: 'designing',                 trigger: 'intent_clear' },
  { from: 'waiting_for_clarification', to: 'designing',                 trigger: 'clarification_received' },
  { from: 'designing',                 to: 'generating_context',        trigger: 'design_complete' },
  { from: 'generating_context',        to: 'coding',                    trigger: 'context_and_lint_complete' },
  { from: 'coding',                    to: 'testing',                   trigger: 'code_complete' },
  { from: 'testing',                   to: 'awaiting_gate',             trigger: 'tests_complete' },
  { from: 'awaiting_gate',             to: 'gate_failed',               trigger: 'gate_rejected' },
  { from: 'awaiting_gate',             to: 'approved',                  trigger: 'gate_approved' },
  { from: 'gate_failed',               to: 'designing',                 trigger: 'retry_from_design' },
  { from: 'gate_failed',               to: 'coding',                    trigger: 'retry_from_code' },
  { from: 'gate_failed',               to: 'escalated',                 trigger: 'max_retries_exceeded' },
  { from: 'gate_failed',               to: 'escalated',                 trigger: 'golden_principle_breach' },
];

/**
 * Returns the valid next state given the current state and trigger.
 * Throws if the transition is not defined — invalid transitions are bugs.
 */
export function transition(
  current: OrchestratorState,
  trigger: string,
): OrchestratorState {
  const match = VALID_TRANSITIONS.find(
    (t) => t.from === current && t.trigger === trigger,
  );

  if (!match) {
    throw new Error(
      `Invalid state transition: ${current} + ${trigger} has no defined target state`,
    );
  }

  return match.to;
}

/**
 * Returns true if a state is terminal (no further transitions possible
 * without external input).
 */
export function isTerminalState(state: OrchestratorState): boolean {
  return state === 'approved' || state === 'escalated';
}

/**
 * Returns true if a state is a waiting state (paused for human input).
 */
export function isWaitingState(state: OrchestratorState): boolean {
  return state === 'waiting_for_clarification' || state === 'escalated';
}
