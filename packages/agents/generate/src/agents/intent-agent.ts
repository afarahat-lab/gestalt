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

import type { AgentTask, AgentResult, ClarificationNeeded, IntentSpec, Ambiguity } from '../types';
import { buildIntentPrompt } from '../prompts/intent-prompt';

const MAX_INTERNAL_RETRIES = 2;

/**
 * Intents queued by a maintenance agent carry this exact prefix on their
 * text (see ADR-035). The clarification gate must NOT fire for them —
 * `MaintenanceIntent` payloads are typed and self-contained; an empty
 * `successCriteria` array on a maintenance-sourced intent is the
 * maintenance-agent telling the generate layer "I will not synthesise
 * tests; just apply the structural change."
 */
const MAINTENANCE_PREFIX = '[gestalt-maintenance/';

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

  // Capture the most recent attempt's prompt + response so the
  // orchestrator can persist them into `agent_execution_logs` even when
  // every attempt fails. Reset each iteration; the values surviving the
  // loop belong to the last attempt the agent made.
  let lastPrompt: string | undefined;
  let lastLlmResponse: string | undefined;

  for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
    try {
      const prompt = buildIntentPrompt(task.contextSnapshot, attempt, task.clarification);
      lastPrompt = prompt;
      const raw = await llmCall(prompt);
      lastLlmResponse = raw;
      const spec = parseIntentSpec(raw, task.correlationId, rawIntentText);
      validateIntentSpec(spec);

      // Clarification gate. Runs AFTER the LLM call (we trust the LLM's
      // structured output to drive the decision, not a pre-flight regex).
      // Skipped for maintenance-sourced intents — those are typed
      // `MaintenanceIntent` objects, not free-form vague text, so even
      // an empty successCriteria array is a legitimate signal that the
      // maintenance agent didn't synthesise tests.
      const clarificationNeeded = needsClarification(spec, rawIntentText, task.intentSource);
      if (clarificationNeeded) {
        return {
          agentRole: 'intent-agent',
          status: 'clarification-needed',
          clarificationNeeded,
          lastPrompt,
          llmResponse: lastLlmResponse,
          artifacts: [
            // Still persist the intent-spec — the resume cycle will
            // overwrite it with a better one, and the operator may want
            // to see what the LLM extracted even when it isn't enough.
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
          signals: [
            {
              id: crypto.randomUUID(),
              correlationId: task.correlationId,
              type: 'CONTEXT_GAP',
              severity: 'high',
              sourceAgent: 'intent-agent',
              message: `Intent requires clarification: ${clarificationNeeded.reason}`,
              // Cannot be auto-resolved by the gate's retry loop —
              // only a human-supplied clarification (POST /clarify) can
              // make progress. Routes through the alerts surface, not
              // through the gate ↔ generate feedback router.
              autoResolvable: false,
              createdAt: new Date(),
            },
          ],
          tokensUsed: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        agentRole: 'intent-agent',
        status: 'completed',
        lastPrompt,
        llmResponse: lastLlmResponse,
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
    lastPrompt,
    llmResponse: lastLlmResponse,
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
 * Returns a `ClarificationNeeded` describing why the cycle must pause,
 * or `null` if the spec is good enough to proceed. Maintenance-sourced
 * intents are exempted up front: their text always carries the
 * `[gestalt-maintenance/<type>]` prefix the maintenance runner adds,
 * and their structure is governed by ADR-035, not by operator prose.
 */
function needsClarification(
  spec: IntentSpec,
  rawIntentText: string,
  intentSource: 'human' | 'maintenance-agent' | undefined,
): ClarificationNeeded | null {
  if (intentSource === 'maintenance-agent') return null;
  if (rawIntentText.startsWith(MAINTENANCE_PREFIX)) return null;

  const suggestions = [
    'Describe the specific feature you want to build',
    'Include what the feature should do and what inputs/outputs it has',
    'Describe what "done" looks like — what can a user do after this is built?',
  ];

  if (spec.successCriteria.length === 0) {
    return {
      reason: 'Intent is too vague — no success criteria could be extracted.',
      suggestions,
    };
  }

  const highImpact = spec.ambiguities.find((a) => a.impactIfWrong === 'high');
  if (highImpact) {
    return {
      reason: `High-impact ambiguity: ${highImpact.description}`,
      suggestions: [
        `Choose between: ${highImpact.options.join(' / ')}`,
        ...suggestions,
      ],
    };
  }

  return null;
}

/**
 * Converts high-impact ambiguities into CONTEXT_GAP signals.
 * Low and medium impact ambiguities are documented but do not signal.
 *
 * Note: when `needsClarification` returns non-null the clarification
 * gate fires first and we never reach this function — so the
 * "low/medium ambiguities only" framing still holds for the
 * completed-status path.
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
