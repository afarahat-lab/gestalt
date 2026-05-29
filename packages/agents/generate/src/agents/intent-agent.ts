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

  // The operator's intent text always wins — the LLM is asked to summarise
  // and classify, not to round-trip the original string. assembleContext has
  // already placed it on the snapshot's intentSpec.rawIntent.
  const rawIntentText = task.contextSnapshot.intentSpec.rawIntent;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildIntentPrompt(task.contextSnapshot, attempt);
      const raw = await llmCall(prompt);
      const spec = parseIntentSpec(raw, task.correlationId, rawIntentText);
      validateIntentSpec(spec);

      return {
        agentRole: 'intent-agent',
        status: 'completed',
        artifacts: [
          {
            id: crypto.randomUUID(),
            correlationId: task.correlationId,
            type: 'design',
            path: '.gestalt/intent-spec.json',
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
        autoResolvable: true,
        createdAt: new Date(),
      },
    ],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Parses the LLM response into a structured IntentSpec.
 * Expects the LLM to return JSON — prompt enforces this.
 *
 * `rawIntent` is always overwritten with `rawIntentText` (the operator's
 * actual intent string from the BullMQ payload). The LLM is not trusted to
 * round-trip the input verbatim and this avoids spurious "missing rawIntent"
 * validation failures when the model paraphrases or omits it.
 */
function parseIntentSpec(
  raw: string,
  correlationId: string,
  rawIntentText: string,
): IntentSpec {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as Partial<IntentSpec>;

  return {
    id: crypto.randomUUID(),
    correlationId,
    rawIntent: rawIntentText,
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
 *
 * Only checks rawIntent (always populated by the orchestrator from the
 * operator's input — its absence indicates a real plumbing bug, not LLM
 * variance). Empty `affectedDomains` and `successCriteria` arrays are
 * allowed: on a greenfield project there are no existing domains for the
 * LLM to reference, and on an exploratory intent the LLM may legitimately
 * defer success-criteria definition to downstream agents.
 */
function validateIntentSpec(spec: IntentSpec): void {
  if (!spec.rawIntent) throw new Error('IntentSpec missing rawIntent');
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
      autoResolvable: true,
      createdAt: new Date(),
    }));
}
