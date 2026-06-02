/**
 * LLM prompt builder for the lint-config agent.
 * Updates ESLint constraint rules for new module boundaries.
 */

import type { ContextSnapshot } from '../types';
import { applyAgentConfig } from './agent-config-helpers';

export function buildLintConfigPrompt(ctx: ContextSnapshot, _attempt: number): string {
  const body = `Update the ESLint configuration to enforce boundaries for new modules.

## New domain changes

${ctx.priorArtifacts.find((a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/design-spec.json'))?.content ?? '{}'}

## Current architecture

${ctx.architectureMd.slice(0, 1000)}

Generate updated ESLint rules as JSON. Return { "rules": { ... } } only.
`;
  return applyAgentConfig(body, ctx.agentConfig);
}
