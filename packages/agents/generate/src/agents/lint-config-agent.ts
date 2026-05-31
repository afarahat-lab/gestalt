/**
 * Lint config agent — updates ESLint constraint rules when new module boundaries are introduced.
 * Can skip: Yes — if no new module boundaries in the intent.
 */

import type { AgentTask, AgentResult, LlmCallFn } from '../types';

export async function runLintConfigAgent(
  task: AgentTask,
  _llmCall: LlmCallFn,
): Promise<AgentResult> {
  const startedAt = Date.now();

  // Skip if design did not introduce new module boundaries
  const designArtifact = task.contextSnapshot.priorArtifacts.find(
    (a) => a.path === '.gestalt/design-spec.json',
  );

  if (!designArtifact) {
    return {
      agentRole: 'lint-config-agent',
      status: 'skipped',
      skipReason: 'No design artifact found — no new module boundaries to configure',
      artifacts: [],
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const design = safeParseJson(designArtifact.content) as { domainChanges?: unknown[] } | null;
  if (!design?.domainChanges?.length) {
    return {
      agentRole: 'lint-config-agent',
      status: 'skipped',
      skipReason: 'Design introduces no domain changes requiring lint config updates',
      artifacts: [],
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // Phase 2: generate updated ESLint config with new module boundary rules
  // For now: return completed with no artifacts (existing rules sufficient)
  return {
    agentRole: 'lint-config-agent',
    status: 'completed',
    artifacts: [],
    signals: [],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
}

function safeParseJson(content: string): unknown | null {
  try { return JSON.parse(content); } catch { return null; }
}
