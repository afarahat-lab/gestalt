/**
 * Design agent — produces domain model changes, API contracts, component specs.
 * Always runs. Reads IntentSpec from prior artifacts.
 */

import type { AgentTask, AgentResult, DesignArtifact, LlmCallFn } from '../types';
import { buildDesignPrompt } from '../prompts/design-prompt';

const MAX_INTERNAL_RETRIES = 2;

export async function runDesignAgent(
  task: AgentTask,
  llmCall: LlmCallFn,
): Promise<AgentResult> {
  const startedAt = Date.now();
  let lastError: Error | undefined;
  let lastPrompt: string | undefined;
  let lastLlmResponse: string | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildDesignPrompt(task.contextSnapshot, attempt);
      lastPrompt = prompt;
      const raw = await llmCall(prompt, task.contextSnapshot.agentConfig.llm);
      lastLlmResponse = raw;
      const design = parseDesignArtifact(raw, task.correlationId);

      return {
        agentRole: 'design-agent',
        status: 'completed',
        lastPrompt,
        llmResponse: lastLlmResponse,
        artifacts: [
          {
            id: crypto.randomUUID(),
            correlationId: task.correlationId,
            type: 'design',
            path: '.gestalt/design-spec.json',
            content: JSON.stringify(design, null, 2),
            producedBy: 'design-agent',
            createdAt: new Date(),
          },
        ],
        signals: [],
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return failedResult('design-agent', task.correlationId, startedAt, lastError, lastPrompt, lastLlmResponse);
}

function parseDesignArtifact(raw: string, correlationId: string): DesignArtifact {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as Partial<DesignArtifact>;
  return {
    correlationId,
    domainChanges: parsed.domainChanges ?? [],
    apiContracts: parsed.apiContracts ?? [],
    componentSpecs: parsed.componentSpecs ?? [],
  };
}

function failedResult(
  agentRole: AgentResult['agentRole'],
  correlationId: string,
  startedAt: number,
  error?: Error,
  lastPrompt?: string,
  llmResponse?: string,
): AgentResult {
  return {
    agentRole,
    status: 'failed',
    lastPrompt,
    llmResponse,
    artifacts: [],
    signals: [{
      id: crypto.randomUUID(),
      correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      sourceAgent: agentRole,
      message: `${agentRole} failed: ${error?.message ?? 'unknown error'}`,
      autoResolvable: false,
      createdAt: new Date(),
    }],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
}
