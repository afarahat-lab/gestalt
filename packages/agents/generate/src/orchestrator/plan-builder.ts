/**
 * Builds the fixed execution graph for the generate layer.
 * Order: intent → design → [context, lint-config] → code → test
 *
 * Agents that declare SKIPPED are still included in the plan —
 * they self-report skip at runtime. The graph shape never changes.
 */

import type { ExecutionPlan, PlanStep } from '../types';

const FIXED_GRAPH: Omit<PlanStep, 'status' | 'result'>[] = [
  {
    order: 1,
    agentRole: 'intent-agent',
    dependsOn: [],
    parallel: false,
  },
  {
    order: 2,
    agentRole: 'design-agent',
    dependsOn: ['intent-agent'],
    parallel: false,
  },
  {
    order: 3,
    agentRole: 'context-agent',
    dependsOn: ['design-agent'],
    parallel: true,  // runs in parallel with lint-config-agent
  },
  {
    order: 3,
    agentRole: 'lint-config-agent',
    dependsOn: ['design-agent'],
    parallel: true,  // runs in parallel with context-agent
  },
  {
    order: 4,
    agentRole: 'code-agent',
    dependsOn: ['context-agent', 'lint-config-agent'],
    parallel: false,
  },
  {
    order: 5,
    agentRole: 'test-agent',
    dependsOn: ['code-agent'],
    parallel: false,
  },
];

/**
 * Builds the initial execution plan for a given intent.
 * All steps start in 'pending' state.
 */
export function buildExecutionPlan(
  correlationId: string,
  intentId: string,
): ExecutionPlan {
  const steps: PlanStep[] = FIXED_GRAPH.map((step) => ({
    ...step,
    status: 'pending',
  }));

  return {
    correlationId,
    intentId,
    steps,
    state: 'received',
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Returns steps whose dependencies are all completed or skipped —
 * i.e. steps ready to execute right now.
 */
export function getReadySteps(plan: ExecutionPlan): PlanStep[] {
  const doneRoles = new Set(
    plan.steps
      .filter((s) => s.status === 'completed' || s.status === 'skipped')
      .map((s) => s.agentRole),
  );

  return plan.steps.filter(
    (step) =>
      step.status === 'pending' &&
      step.dependsOn.every((dep) => doneRoles.has(dep)),
  );
}

/**
 * Returns true if all steps are completed or skipped.
 */
export function isPlanComplete(plan: ExecutionPlan): boolean {
  return plan.steps.every(
    (s) => s.status === 'completed' || s.status === 'skipped',
  );
}

/**
 * Returns true if any step has failed.
 */
export function hasPlanFailed(plan: ExecutionPlan): boolean {
  return plan.steps.some((s) => s.status === 'failed');
}

/**
 * Collects all artifacts produced by completed steps up to (but not including)
 * the given agent role. Used to assemble ContextSnapshot.priorArtifacts.
 */
export function getPriorArtifacts(
  plan: ExecutionPlan,
  forAgent: string,
): PlanStep['result'][] {
  const targetOrder = FIXED_GRAPH.find((s) => s.agentRole === forAgent)?.order ?? 0;

  return plan.steps
    .filter((s) => s.order < targetOrder && s.result !== undefined)
    .map((s) => s.result)
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
}
