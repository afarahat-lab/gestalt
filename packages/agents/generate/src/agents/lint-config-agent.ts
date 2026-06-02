/**
 * Lint config agent — updates ESLint constraint rules when new module
 * boundaries are introduced. Can skip in two ways:
 *   1. No design artifact present
 *   2. Design introduces no domain changes
 *
 * Today this agent doesn't actually call the LLM — Phase 2 will
 * generate updated ESLint rules from the design spec. The class
 * extends `BaseLLMAgent` for consistency with the other agents in
 * the package (uniform instantiation + execution-log surface), but
 * `lastPrompt` / `lastLlmResponse` / `lastModelUsed` stay null on
 * the instance because no LLM call ever happens.
 */

import type { AgentTask, AgentResult } from '../types';
import { BaseLLMAgent } from './base-llm-agent';

export class LintConfigAgent extends BaseLLMAgent {
  constructor() { super('lint-config-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();

    const designArtifact = task.contextSnapshot.priorArtifacts.find(
      (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/design-spec.json'),
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

    // Phase 2: generate updated ESLint config with new module boundary
    // rules. For now: return completed with no artifacts (existing
    // rules sufficient). This will be the point where the agent
    // calls `this.callLLM(...)` once the prompt is wired.
    return {
      agentRole: 'lint-config-agent',
      status: 'completed',
      artifacts: [],
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  protected buildPrompt(): string {
    throw new Error('LintConfigAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('LintConfigAgent.parseResponse is not used — see overridden run()');
  }
}

function safeParseJson(content: string): unknown | null {
  try { return JSON.parse(content); } catch { return null; }
}
