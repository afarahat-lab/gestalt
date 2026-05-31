/**
 * Context agent — updates context files when intent changes project scope.
 * Can skip: Yes — if no context files need updating.
 */

import type { AgentTask, AgentResult } from '../types';
import { buildContextPrompt } from '../prompts/context-prompt';
import { createHarnessEngine } from '@gestalt/core';

const MAX_INTERNAL_RETRIES = 2;

export async function runContextAgent(
  task: AgentTask,
  llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  const startedAt = Date.now();

  // Skip if intent does not touch context files
  const intentSpec = task.contextSnapshot.intentSpec;
  const touchesDomain = intentSpec.scope.affectedLayers.includes('domain');
  const addsNewModule = intentSpec.scope.affectedDomains.some(
    (d) => !task.contextSnapshot.domain.entities.find((e) => e.name.toLowerCase() === d.toLowerCase()),
  );

  if (!touchesDomain && !addsNewModule) {
    return {
      agentRole: 'context-agent',
      status: 'skipped',
      skipReason: 'Intent does not affect domain model or module structure',
      artifacts: [],
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  let lastError: Error | undefined;
  let lastPrompt: string | undefined;
  let lastLlmResponse: string | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildContextPrompt(task.contextSnapshot, attempt);
      lastPrompt = prompt;
      const raw = await llmCall(prompt);
      lastLlmResponse = raw;
      const updates = parseContextUpdates(raw);

      const artifacts: AgentResult['artifacts'] = [];
      const engine = createHarnessEngine(task.contextSnapshot.projectRoot);

      for (const update of updates) {
        await engine.writeContextFile(update.path, update.content);
        artifacts.push({
          id: crypto.randomUUID(),
          correlationId: task.correlationId,
          type: 'context-file',
          path: update.path,
          content: update.content,
          producedBy: 'context-agent',
          createdAt: new Date(),
        });
      }

      return {
        agentRole: 'context-agent',
        status: 'completed',
        lastPrompt,
        llmResponse: lastLlmResponse,
        artifacts,
        signals: [],
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return {
    agentRole: 'context-agent',
    status: 'failed',
    lastPrompt,
    llmResponse: lastLlmResponse,
    artifacts: [],
    signals: [{
      id: crypto.randomUUID(),
      correlationId: task.correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      sourceAgent: 'context-agent',
      message: `Context agent failed: ${lastError?.message ?? 'unknown error'}`,
      autoResolvable: false,
      createdAt: new Date(),
    }],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
}

function parseContextUpdates(raw: string): Array<{ path: string; content: string }> {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as { updates?: Array<{ path: string; content: string }> };
  return parsed.updates ?? [];
}
