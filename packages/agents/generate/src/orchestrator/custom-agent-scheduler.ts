/**
 * Custom agent scheduler (ADR-037 / runs_after enforcement).
 *
 * Validates `runs_after` declarations on custom agents loaded from
 * `agents.yaml` and produces a topologically-sorted execution order
 * where each agent appears AFTER its dependency. Used by both the
 * generate orchestrator (at cycle start) and the
 * `GET /projects/:id/agents/validate` endpoint (so operators can
 * catch config errors before submitting an intent).
 *
 * Throws on:
 *   - unknown `runs_after` target (not a framework agent, not another
 *     custom agent in the same file)
 *   - cycles in the custom-agent dependency graph
 *
 * Default: a custom agent with `runs_after: null` (absent in YAML)
 * gets `dependsOn: 'test-agent'`. test-agent is the last framework
 * agent in the fixed generate-graph (ADR-009), so this matches the
 * pre-enforcement behaviour — legacy projects without `runs_after`
 * see no change.
 */

import type { CustomAgentDefinition, CustomAgentNode } from '../types';

/**
 * The framework agent names a custom agent may legally name in
 * `runs_after`. Mirrors the ADR-009 fixed graph; `context-fixer` is
 * the maintenance-layer exception and is not a valid generate-cycle
 * dependency.
 */
export const FRAMEWORK_AGENT_NAMES = new Set([
  'intent-agent', 'design-agent', 'context-agent',
  'lint-config-agent', 'code-agent', 'test-agent',
]);

/**
 * Default `dependsOn` when the custom agent didn't declare
 * `runs_after`. Picked so an unscheduled agent runs after every
 * framework agent — same effect the pre-enforcement implementation
 * had.
 */
const DEFAULT_RUNS_AFTER: string = 'test-agent';

export function scheduleCustomAgents(
  definitions: CustomAgentDefinition[],
): CustomAgentNode[] {
  if (definitions.length === 0) return [];

  const allAgentNames = new Set<string>([
    ...FRAMEWORK_AGENT_NAMES,
    ...definitions.map((d) => d.name),
  ]);

  // Validate every runs_after target before any topo work. We don't
  // want a half-sorted output if the operator typo'd a single name.
  for (const def of definitions) {
    const target = def.runsAfter;
    if (target === null) continue;
    if (target === def.name) {
      throw new Error(
        `Custom agent '${def.name}' declares runs_after: '${target}' — ` +
        `a custom agent cannot depend on itself.`,
      );
    }
    if (!allAgentNames.has(target)) {
      throw new Error(
        `Custom agent '${def.name}' declares runs_after: '${target}' ` +
        `but no agent with that name exists. ` +
        `Valid targets: ${[...allAgentNames].sort().join(', ')}`,
      );
    }
  }

  // Resolve `null` to the default. After this every node has a
  // concrete `dependsOn` string.
  const nodes: CustomAgentNode[] = definitions.map((def) => ({
    definition: def,
    dependsOn: def.runsAfter ?? DEFAULT_RUNS_AFTER,
  }));

  return topologicalSort(nodes);
}

/**
 * Kahn's algorithm. We only edge custom→custom dependencies — when a
 * custom agent depends on a framework agent, that edge isn't
 * relevant to the inter-custom ordering (every custom agent that
 * depends on a framework agent is necessarily independent of the
 * other customs unless an explicit edge says otherwise).
 *
 * Stable on the input order: agents pushed onto the ready queue in
 * declaration order, and ties broken by declaration order. So an
 * operator's intent ("security first, then performance") survives
 * round-tripping when both depend on `code-agent`.
 */
function topologicalSort(nodes: CustomAgentNode[]): CustomAgentNode[] {
  const customNames = new Set(nodes.map((n) => n.definition.name));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.definition.name, 0);
    dependents.set(node.definition.name, []);
  }

  for (const node of nodes) {
    if (customNames.has(node.dependsOn)) {
      // custom→custom edge — increases the dependent's in-degree
      inDegree.set(
        node.definition.name,
        (inDegree.get(node.definition.name) ?? 0) + 1,
      );
      dependents.get(node.dependsOn)!.push(node.definition.name);
    }
  }

  const queue: string[] = [];
  // Walk nodes in declaration order so the ready queue preserves it
  for (const node of nodes) {
    if ((inDegree.get(node.definition.name) ?? 0) === 0) {
      queue.push(node.definition.name);
    }
  }

  const sorted: CustomAgentNode[] = [];
  const byName = new Map(nodes.map((n) => [n.definition.name, n]));

  while (queue.length > 0) {
    const name = queue.shift()!;
    const node = byName.get(name)!;
    sorted.push(node);

    for (const dep of dependents.get(name) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length < nodes.length) {
    const remaining = nodes
      .filter((n) => !sorted.find((s) => s.definition.name === n.definition.name))
      .map((n) => n.definition.name);
    throw new Error(
      `Cycle detected in custom agent dependencies: ${remaining.join(' → ')}. ` +
      `Custom agents cannot form dependency cycles.`,
    );
  }

  return sorted;
}
