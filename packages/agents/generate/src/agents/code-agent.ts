/**
 * Code agent — generates application code from design artifacts.
 *
 * Always runs; receives design + context as prior artifacts. Has an
 * internal retry budget — if the LLM returns a malformed JSON or no
 * code files, the agent retries up to `MAX_INTERNAL_RETRIES + 1`
 * total attempts. These are distinct from the gate's outer retry
 * loop: internal retries are about JSON parse failure, gate retries
 * are about quality failure (lint, test, constraint).
 */

import type { AgentTask, AgentResult, GeneratedArtifact } from '../types';
import { buildCodePrompt } from '../prompts/code-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { BaseLLMAgent } from './base-llm-agent';

const MAX_INTERNAL_RETRIES = 2;

export class CodeAgent extends BaseLLMAgent {
  constructor() { super('code-agent'); }

  /**
   * Overrides the base template to run the internal retry loop.
   * Each iteration calls `this.callLLM` (so `lastPrompt` +
   * `lastLlmResponse` + `lastModelUsed` reflect the LAST attempt,
   * which is what the orchestrator persists).
   */
  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig } = task.contextSnapshot;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildCodePrompt(task.contextSnapshot, attempt, task.priorSignals);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        const raw = await this.callLLM(prompt, agentConfig, task.correlationId);
        const codeFiles = parseCodeFiles(raw, task.correlationId);
        if (codeFiles.length === 0) throw new Error('LLM returned no code files');

        return {
          agentRole: 'code-agent',
          status: 'completed',
          artifacts: codeFiles,
          signals: [],
          tokensUsed: 0,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return {
      agentRole: 'code-agent',
      status: 'failed',
      artifacts: [],
      signals: [this.makeContextGapSignal(
        task.correlationId,
        `Code agent failed: ${lastError?.message}`,
      )],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // Required by the abstract base; not reached because `run` is
  // overridden above. Throws so a misuse via `super.run(task)` is
  // detectable instead of silently misbehaving.
  protected buildPrompt(): string {
    throw new Error('CodeAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('CodeAgent.parseResponse is not used — see overridden run()');
  }
}

function parseCodeFiles(raw: string, correlationId: string): GeneratedArtifact[] {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as { files?: Array<{ path: string; content: string }> };
  return (parsed.files ?? []).map((f) => ({
    id: crypto.randomUUID(),
    correlationId,
    type: 'code' as const,
    path: f.path,
    content: f.content,
    producedBy: 'code-agent' as const,
    createdAt: new Date(),
  }));
}
