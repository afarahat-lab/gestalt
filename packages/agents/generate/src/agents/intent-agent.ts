/**
 * Intent agent — always the first to run.
 *
 * Responsibilities:
 * - Parses raw intent text into a structured IntentSpec
 * - Detects ambiguities and classifies their impact
 * - Extracts success criteria that will become test cases
 * - Identifies affected domains and layers from the harness context
 *
 * This agent never skips. If intent is received, this agent runs.
 */

import type { AgentTask, AgentResult, IntentSpec, Ambiguity } from '../types';
import { buildIntentPrompt } from '../prompts/intent-prompt';

const MAX_INTERNAL_RETRIES = 2;

/**
 * Runs the intent agent for the given task.
 * Returns a completed AgentResult with the IntentSpec as an artifact,
 * or a failed result with signals if parsing could not succeed.
 */
export async function runIntentAgent(
  task: AgentTask,
  llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  const startedAt = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildIntentPrompt(task.contextSnapshot, attempt);
      const raw = await llmCall(prompt);
      const spec = parseIntentSpec(raw, task.correlationId);
      validateIntentSpec(spec);

      return {
        agentRole: 'intent-agent',
        status: 'completed',
        artifacts: [
          {
            id: crypto.randomUUID(),
            correlationId: task.correlationId,
            type: 'design',
            path: '.agentforge/intent-spec.json',
            content: JSON.stringify(spec, null, 2),
            producedBy: 'intent-agent',
            createdAt: new Date(),
          },
        ],
        signals: buildAmbiguitySignals(spec.ambiguities, task.correlationId),
        tokensUsed: 0,   // populated by LLM wrapper in core
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // All retries exhausted
  return {
    agentRole: 'intent-agent',
    status: 'failed',
    artifacts: [],
    signals: [
      {
        id: crypto.randomUUID(),
        correlationId: task.correlationId,
        type: 'CONTEXT_GAP',
        severity: 'high',
        sourceAgent: 'intent-agent',
        message: `Intent parsing failed after ${MAX_INTERNAL_RETRIES + 1} attempts: ${lastError?.message}`,
      },
    ],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Parses the LLM response into a structured IntentSpec.
 * Expects the LLM to return JSON — prompt enforces this.
 */
function parseIntentSpec(raw: string, correlationId: string): IntentSpec {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as Partial<IntentSpec>;

  return {
    id: crypto.randomUUID(),
    correlationId,
    rawIntent: parsed.rawIntent ?? '',
    scope: {
      affectedDomains: parsed.scope?.affectedDomains ?? [],
      affectedLayers: parsed.scope?.affectedLayers ?? [],
      isBreakingChange: parsed.scope?.isBreakingChange ?? false,
      estimatedComplexity: parsed.scope?.estimatedComplexity ?? 'medium',
    },
    successCriteria: parsed.successCriteria ?? [],
    constraints: parsed.constraints ?? [],
    outOfScope: parsed.outOfScope ?? [],
    ambiguities: parsed.ambiguities ?? [],
  };
}

/**
 * Validates that the intent spec has the minimum required fields.
 */
function validateIntentSpec(spec: IntentSpec): void {
  if (!spec.rawIntent) throw new Error('IntentSpec missing rawIntent');
  if (!spec.scope.affectedDomains.length) throw new Error('IntentSpec has no affected domains');
  if (!spec.successCriteria.length) throw new Error('IntentSpec has no success criteria');
}

/**
 * Converts high-impact ambiguities into CONTEXT_GAP signals.
 * Low and medium impact ambiguities are documented but do not signal.
 */
function buildAmbiguitySignals(
  ambiguities: Ambiguity[],
  correlationId: string,
): AgentResult['signals'] {
  return ambiguities
    .filter((a) => a.impactIfWrong === 'high')
    .map((a) => ({
      id: crypto.randomUUID(),
      correlationId,
      type: 'CONTEXT_GAP' as const,
      severity: 'high' as const,
      sourceAgent: 'intent-agent' as const,
      message: `Ambiguity detected: ${a.description}. Options: ${a.options.join(' | ')}`,
    }));
}
