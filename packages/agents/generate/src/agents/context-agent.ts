/**
 * Context agent — updates context files (DOMAIN.md, ARCHITECTURE.md)
 * when an intent changes the project's domain model or module
 * structure. Can skip when neither condition holds — see the
 * `touchesDomain` / `addsNewModule` gates below.
 */

import type { AgentTask, AgentResult } from '../types';
import { buildContextPrompt } from '../prompts/context-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { createHarnessEngine, extractJsonObject } from '@gestalt/core';
import { BaseLLMAgent } from './base-llm-agent';

const MAX_INTERNAL_RETRIES = 2;

export class ContextAgent extends BaseLLMAgent {
  constructor() { super('context-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig } = task.contextSnapshot;

    // Skip when the intent doesn't change anything context files
    // describe — no LLM call necessary.
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
    const hasBuiltin = (agentConfig.tools?.builtin?.length ?? 0) > 0;
    const hasMcp = (task.mcpClients?.length ?? 0) > 0;
    const useTools = hasBuiltin || hasMcp;
    const projectRoot = task.contextSnapshot.projectRoot;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildContextPrompt(task.contextSnapshot, attempt);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        // ADR-038 + ADR-039 — read existing context files via tools
        // before proposing updates (context-agent's risk is over-
        // writing accurate prose, so reading first matters more here
        // than anywhere else). MCP clients also forwarded when the
        // operator wired any external MCP servers for this agent.
        const raw = useTools
          ? (await this.callLLMWithTools(prompt, agentConfig, projectRoot, task.correlationId, task.mcpClients)).response
          : await this.callLLM(prompt, agentConfig, task.correlationId);
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
      artifacts: [],
      signals: [this.makeContextGapSignal(
        task.correlationId,
        `Context agent failed: ${lastError?.message ?? 'unknown error'}`,
      )],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  protected buildPrompt(): string {
    throw new Error('ContextAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('ContextAgent.parseResponse is not used — see overridden run()');
  }
}

function parseContextUpdates(raw: string): Array<{ path: string; content: string }> {
  const parsed = JSON.parse(extractJsonObject(raw)) as { updates?: Array<{ path: string; content: string }> };
  return parsed.updates ?? [];
}
