/**
 * Test agent — generates a Vitest suite from the IntentSpec's success
 * criteria. Always runs (when criteria exist). Each criterion maps to
 * one or more test cases. Test-generation failure surfaces as a
 * `TEST_FAILURE` signal (auto-resolvable via the gate retry loop).
 */

import type { AgentTask, AgentResult, GeneratedArtifact } from '../types';
import { buildTestPrompt } from '../prompts/test-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { BaseLLMAgent } from './base-llm-agent';

const MAX_INTERNAL_RETRIES = 2;

export class TestAgent extends BaseLLMAgent {
  constructor() { super('test-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig } = task.contextSnapshot;

    if (!task.contextSnapshot.intentSpec.successCriteria.length) {
      return {
        agentRole: 'test-agent',
        status: 'failed',
        artifacts: [],
        signals: [this.makeContextGapSignal(
          task.correlationId,
          'No success criteria in IntentSpec — cannot generate tests',
        )],
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildTestPrompt(task.contextSnapshot, attempt);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        const raw = await this.callLLM(prompt, agentConfig, task.correlationId);
        const testFiles = parseTestFiles(raw, task.correlationId);
        if (testFiles.length === 0) throw new Error('LLM returned no test files');

        return {
          agentRole: 'test-agent',
          status: 'completed',
          artifacts: testFiles,
          signals: [],
          tokensUsed: 0,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return {
      agentRole: 'test-agent',
      status: 'failed',
      artifacts: [],
      signals: [{
        id: crypto.randomUUID(),
        correlationId: task.correlationId,
        type: 'TEST_FAILURE',
        severity: 'medium',
        sourceAgent: 'test-agent',
        message: `Test generation failed: ${lastError?.message}`,
        autoResolvable: true,
        createdAt: new Date(),
      }],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  protected buildPrompt(): string {
    throw new Error('TestAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('TestAgent.parseResponse is not used — see overridden run()');
  }
}

function parseTestFiles(raw: string, correlationId: string): GeneratedArtifact[] {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as { files?: Array<{ path: string; content: string }> };
  return (parsed.files ?? []).map((f) => ({
    id: crypto.randomUUID(),
    correlationId,
    type: 'test' as const,
    path: f.path,
    content: f.content,
    producedBy: 'test-agent' as const,
    createdAt: new Date(),
  }));
}
