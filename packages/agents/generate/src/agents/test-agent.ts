/**
 * Test agent — generates test suite from IntentSpec success criteria.
 * Always runs. Each success criterion maps to one or more test cases.
 */

import type { AgentTask, AgentResult, GeneratedArtifact } from '../types';
import { buildTestPrompt } from '../prompts/test-prompt';

const MAX_INTERNAL_RETRIES = 2;

export async function runTestAgent(
  task: AgentTask,
  llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  const startedAt = Date.now();

  if (!task.contextSnapshot.intentSpec.successCriteria.length) {
    return {
      agentRole: 'test-agent',
      status: 'failed',
      artifacts: [],
      signals: [{
        id: crypto.randomUUID(),
        correlationId: task.correlationId,
        type: 'CONTEXT_GAP',
        severity: 'high',
        sourceAgent: 'test-agent',
        message: 'No success criteria in IntentSpec — cannot generate tests',
        autoResolvable: false,
        createdAt: new Date(),
      }],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  let lastError: Error | undefined;
  let lastPrompt: string | undefined;
  let lastLlmResponse: string | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildTestPrompt(task.contextSnapshot, attempt);
      lastPrompt = prompt;
      const raw = await llmCall(prompt);
      lastLlmResponse = raw;
      const testFiles = parseTestFiles(raw, task.correlationId);
      if (testFiles.length === 0) throw new Error('LLM returned no test files');

      return {
        agentRole: 'test-agent',
        status: 'completed',
        lastPrompt,
        llmResponse: lastLlmResponse,
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
    lastPrompt,
    llmResponse: lastLlmResponse,
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
