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
 *
 * The clarification gate runs AFTER the LLM call (trusts the LLM's
 * structured output to drive the decision, not a pre-flight regex).
 * Maintenance-sourced intents bypass clarification — see ADR-035.
 */

import type {
  AgentTask, AgentResult, ClarificationNeeded, IntentSpec, Ambiguity,
} from '../types';
import { buildIntentPrompt } from '../prompts/intent-prompt';
import { applyAgentConfig } from '../prompts/agent-config-helpers';
import { BaseLLMAgent } from './base-llm-agent';

const MAX_INTERNAL_RETRIES = 2;

/**
 * Intents queued by a maintenance agent carry this exact prefix on their
 * text (see ADR-035). The clarification gate must NOT fire for them —
 * `MaintenanceIntent` payloads are typed and self-contained.
 */
const MAINTENANCE_PREFIX = '[gestalt-maintenance/';

export class IntentAgent extends BaseLLMAgent {
  constructor() { super('intent-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig } = task.contextSnapshot;
    const rawIntentText = task.contextSnapshot.intentSpec.rawIntent;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_INTERNAL_RETRIES; attempt++) {
      try {
        const rawPrompt = buildIntentPrompt(task.contextSnapshot, attempt, task.clarification);
        const prompt = applyAgentConfig(rawPrompt, agentConfig);
        const raw = await this.callLLM(prompt, agentConfig, task.correlationId);
        const spec = parseIntentSpec(raw, task.correlationId, rawIntentText);
        validateIntentSpec(spec);

        const clarificationNeeded = needsClarification(spec, rawIntentText, task.intentSource);
        if (clarificationNeeded) {
          return {
            agentRole: 'intent-agent',
            status: 'clarification-needed',
            clarificationNeeded,
            artifacts: [
              // Persist whatever the LLM did extract; the resume cycle
              // will overwrite, but operators can inspect the partial
              // spec to understand what was missing.
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
                // Hard-coded `autoResolvable: false` (not the
                // base-class helper) — only a human-supplied
                // clarification (POST /clarify) can satisfy this;
                // the gate's retry loop must not retry the cycle
                // automatically.
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
          tokensUsed: 0,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return {
      agentRole: 'intent-agent',
      status: 'failed',
      artifacts: [],
      signals: [
        // Auto-resolvable: a fresh retry cycle may produce a parseable
        // spec where the prior attempts didn't. Distinct from the
        // clarification-needed `autoResolvable: false` path above.
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

  protected buildPrompt(): string {
    throw new Error('IntentAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('IntentAgent.parseResponse is not used — see overridden run()');
  }
}

/**
 * Parses the LLM response into a structured IntentSpec.
 * `rawIntent` is always overwritten with `rawIntentText` (the operator's
 * actual intent string from the BullMQ payload). The LLM is not trusted
 * to round-trip the input verbatim.
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

function validateIntentSpec(spec: IntentSpec): void {
  if (!spec.rawIntent) throw new Error('IntentSpec missing rawIntent');
}

/**
 * Returns a `ClarificationNeeded` describing why the cycle must pause,
 * or `null` if the spec is good enough to proceed. Maintenance-sourced
 * intents are exempted: their text carries the
 * `[gestalt-maintenance/<type>]` prefix the maintenance runner adds,
 * and ADR-035 governs their structure.
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
