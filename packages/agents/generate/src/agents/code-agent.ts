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

import type { AgentTask, AgentResult, GeneratedArtifact, FeedbackSignal } from '../types';
import { buildCodePrompt } from '../prompts/code-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { BaseLLMAgent } from './base-llm-agent';
import { extractJsonObject } from '@gestalt/core';

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

    const hasBuiltin = (agentConfig.tools?.builtin?.length ?? 0) > 0;
    const hasMcp = (task.mcpClients?.length ?? 0) > 0;
    const useTools = hasBuiltin || hasMcp;
    const projectRoot = task.contextSnapshot.projectRoot;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildCodePrompt(task.contextSnapshot, attempt, task.priorSignals);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        // ADR-038 + ADR-039 — drive the OpenAI function-calling loop
        // whenever the resolved agentConfig declares built-in tools OR
        // the orchestrator passed MCP clients for this cycle. Falls
        // through to plain `callLLM` for legacy projects (no
        // agents.yaml, no MCP) and any agent role where the operator
        // has disabled both.
        const raw = useTools
          ? (await this.callLLMWithTools(prompt, agentConfig, projectRoot, task.correlationId, task.mcpClients)).response
          : await this.callLLM(prompt, agentConfig, task.correlationId);
        const parseResult = parseCodeResponse(raw, task.correlationId);
        if (parseResult.files.length === 0) throw new Error('LLM returned no code files');

        // TEST_REPORT_008 Fix 2 — emit a LINT_FAILURE signal when the
        // LLM explicitly tells us the pre-emit verification didn't
        // pass. Low severity because the gate's own constraint /
        // review agents will still get a pass at the artifact. The
        // signal exists so the gate has a heads-up that the
        // generated code may not compile cleanly — useful for the
        // feedback-router's signal-to-agent mapping (TEST_REPORT_005
        // Fix 4 honours `priorSignals` on retry, so a downstream
        // retry will see the verification failure as context).
        const signals: FeedbackSignal[] = [];
        if (parseResult.verificationNote) {
          signals.push({
            id: crypto.randomUUID(),
            correlationId: task.correlationId,
            type: 'LINT_FAILURE',
            severity: 'low',
            sourceAgent: 'code-agent',
            message: `Code-agent pre-emit verification did not pass: ${parseResult.verificationNote}`,
            autoResolvable: true,
            createdAt: new Date(),
          });
        }

        return {
          agentRole: 'code-agent',
          status: 'completed',
          artifacts: parseResult.files,
          signals,
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

/**
 * TEST_REPORT_008 Fix 2 — extended parse result. `verificationNote`
 * is optional; the code-agent's prompt asks the LLM to include it
 * ONLY when the pre-emit `executeScript` verification didn't pass
 * after two attempts. Present → the orchestrator emits a low-
 * severity `LINT_FAILURE` signal so the gate sees the warning.
 */
interface CodeAgentParseResult {
  files: GeneratedArtifact[];
  verificationNote?: string;
}

function parseCodeResponse(raw: string, correlationId: string): CodeAgentParseResult {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    files?: Array<{ path: string; content: string }>;
    verificationNote?: unknown;
  };
  const files = (parsed.files ?? []).map((f) => ({
    id: crypto.randomUUID(),
    correlationId,
    type: 'code' as const,
    path: f.path,
    content: f.content,
    producedBy: 'code-agent' as const,
    createdAt: new Date(),
  }));
  const verificationNote =
    typeof parsed.verificationNote === 'string' && parsed.verificationNote.trim().length > 0
      ? parsed.verificationNote.trim()
      : undefined;
  return verificationNote ? { files, verificationNote } : { files };
}
