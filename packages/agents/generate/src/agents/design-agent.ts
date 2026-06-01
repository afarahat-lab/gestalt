/**
 * Design agent — produces domain model changes, API contracts,
 * component specs. Always runs; reads IntentSpec from prior
 * artifacts. Internal retry on JSON parse failure.
 */

import type { AgentTask, AgentResult, DesignArtifact } from '../types';
import { buildDesignPrompt } from '../prompts/design-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { BaseLLMAgent } from './base-llm-agent';

const MAX_INTERNAL_RETRIES = 2;

export class DesignAgent extends BaseLLMAgent {
  constructor() { super('design-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig } = task.contextSnapshot;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildDesignPrompt(task.contextSnapshot, attempt);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        const raw = await this.callLLM(prompt, agentConfig, task.correlationId);
        const design = parseDesignArtifact(raw, task.correlationId);

        return {
          agentRole: 'design-agent',
          status: 'completed',
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

    return {
      agentRole: 'design-agent',
      status: 'failed',
      artifacts: [],
      signals: [this.makeContextGapSignal(
        task.correlationId,
        `design-agent failed: ${lastError?.message ?? 'unknown error'}`,
      )],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  protected buildPrompt(): string {
    throw new Error('DesignAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('DesignAgent.parseResponse is not used — see overridden run()');
  }
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
