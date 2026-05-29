/**
 * Code agent — generates application code from design artifacts.
 * Always runs. Receives design spec and context as prior artifacts.
 */

import type { AgentTask, AgentResult, GeneratedArtifact } from '../types';
import { buildCodePrompt } from '../prompts/code-prompt';

const MAX_INTERNAL_RETRIES = 2;

export async function runCodeAgent(
  task: AgentTask,
  llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  const startedAt = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildCodePrompt(task.contextSnapshot, attempt, task.priorSignals);
      const raw = await llmCall(prompt);
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
    signals: [{
      id: crypto.randomUUID(),
      correlationId: task.correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      sourceAgent: 'code-agent',
      message: `Code agent failed: ${lastError?.message}`,
      autoResolvable: false,
      createdAt: new Date(),
    }],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
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
