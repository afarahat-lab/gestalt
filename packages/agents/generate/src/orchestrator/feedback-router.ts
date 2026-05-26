/**
 * Routes quality gate feedback signals to the correct specialist agent.
 * Each signal type has a defined resolution path — never generic retry.
 */

import type { AgentRole, SignalType } from '@agentforge-sdlc/core';
import type { FeedbackSignal, GateFeedback } from '../types';

export interface RoutedFeedback {
  targetAgent: AgentRole;
  signals: FeedbackSignal[];
  context: string;  // human-readable routing rationale for logs
}

/**
 * Signal → agent routing table.
 * Defines which agent handles each signal type and why.
 */
const SIGNAL_ROUTES: Record<SignalType, AgentRole> = {
  LINT_FAILURE: 'code-agent',
  TEST_FAILURE: 'code-agent',
  CONSTRAINT_VIOLATION: 'code-agent',
  CONTEXT_GAP: 'context-agent',
  GOLDEN_PRINCIPLE_BREACH: 'orchestrator',  // escalate — never auto-resolve
};

const ROUTING_CONTEXT: Record<SignalType, string> = {
  LINT_FAILURE: 'Style or static analysis failure — code-agent fixes formatting and lint errors',
  TEST_FAILURE: 'Test failure — code-agent fixes implementation, test-agent may re-run',
  CONSTRAINT_VIOLATION: 'Architectural rule violated — code-agent fixes with constraint context injected',
  CONTEXT_GAP: 'Missing context — context-agent updates relevant file, then upstream agent retries',
  GOLDEN_PRINCIPLE_BREACH: 'Non-negotiable violated — escalate to human, loop stops',
};

/**
 * Routes gate feedback signals to their resolution agents.
 * Groups signals by target agent for efficient dispatch.
 * Returns null for GOLDEN_PRINCIPLE_BREACH — caller must escalate.
 */
export function routeFeedback(feedback: GateFeedback): RoutedFeedback[] | null {
  // GOLDEN_PRINCIPLE_BREACH stops the loop — return null to signal escalation
  const hasBreach = feedback.signals.some(
    (s) => s.type === 'GOLDEN_PRINCIPLE_BREACH',
  );
  if (hasBreach) return null;

  // Group signals by target agent
  const grouped = new Map<AgentRole, FeedbackSignal[]>();

  for (const signal of feedback.signals) {
    const target = SIGNAL_ROUTES[signal.type];
    const existing = grouped.get(target) ?? [];
    grouped.set(target, [...existing, signal]);
  }

  return Array.from(grouped.entries()).map(([targetAgent, signals]) => ({
    targetAgent,
    signals,
    context: signals.map((s) => ROUTING_CONTEXT[s.type]).join('; '),
  }));
}

/**
 * Returns true if the feedback contains any signal that requires
 * human escalation (non-auto-resolvable).
 */
export function requiresEscalation(feedback: GateFeedback): boolean {
  return feedback.signals.some((s) => s.type === 'GOLDEN_PRINCIPLE_BREACH');
}

/**
 * Returns true if all signals in the feedback are auto-resolvable.
 */
export function isAutoResolvable(feedback: GateFeedback): boolean {
  const autoResolvable: SignalType[] = ['LINT_FAILURE', 'TEST_FAILURE'];
  return feedback.signals.every((s) => autoResolvable.includes(s.type));
}
