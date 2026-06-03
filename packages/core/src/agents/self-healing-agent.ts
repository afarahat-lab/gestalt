/**
 * SelfHealingAgent (migration 020).
 *
 * The diagnostician for the autonomous self-healing loop. Takes a
 * failure context, asks the LLM to diagnose the root cause, and
 * returns a structured `SelfHealingDiagnosis` the loop uses to
 * decide whether to auto-retry or escalate.
 *
 * The agent extends `BaseLLMAgent` for the standard LLM-call
 * plumbing (model routing via the platform LLM registry, prompt /
 * response capture on the instance, tool-loop support if ever
 * needed). It has no `agents.yaml` config of its own — it carries
 * its own hard-coded persona because the diagnostician role is
 * platform-internal (operators don't tune it).
 *
 * Calls don't throw on parse failure — they return a safe-default
 * diagnosis with `shouldRetry: false, confidence: 'low'` so the
 * loop falls cleanly into human escalation. The brief's invariant
 * "runSelfHealingLoop NEVER throws" depends on this.
 */

import { BaseLLMAgent } from './base-llm-agent';
import type { AgentConfig } from './agent-config';
import { extractJsonObject } from './json-extract';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'self-healing-agent' });

/**
 * The signal-summary shape persisted on `ResumeContext.priorSignals`.
 * Matches `PlatformSignal` minus the runtime-only fields (`id`,
 * `correlationId`, `autoResolvable`, `resolvedBy`, etc.) so the
 * resume context is compact and self-describing.
 */
interface ResumeSignal {
  type: string;
  message: string;
  sourceAgent: string;
  severity: string;
}

/**
 * Read by `SelfHealingAgent.diagnose`. Mirror of the brief — every
 * field except the optional context blocks (architectureMd / etc.)
 * is required. Optional context lets the loop pass whatever it
 * actually has access to.
 */
export interface SelfHealingContext {
  intentText: string;
  intentSpec?: string;
  failureType: string;
  failureSummary: string;
  technicalDetail?: string;
  attemptNumber: number;
  priorSignals: ResumeSignal[];
  priorArtifactPaths: string[];
  architectureMd?: string;
  domainMd?: string;
  goldenPrinciples?: string;
  constraintRules?: string;
}

export interface SelfHealingDiagnosis {
  diagnosis: string;
  rootCause: string;
  suggestedFix: string;
  /** Reframed intent text the orchestrator dispatches as the next cycle. */
  updatedIntentText?: string;
  confidence: 'high' | 'medium' | 'low';
  shouldRetry: boolean;
  /** Agent roles whose output is fine — orchestrator skips on high-confidence retries. */
  skipAgents?: string[];
  /** Files identified as root cause — surfaced in the code-prompt resume section. */
  focusFiles?: string[];
}

const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Hard-coded config for the self-healing agent's LLM call.
 * Platform-internal — operators don't tune this. Temperature 0.1
 * keeps diagnoses deterministic; 2000 tokens is enough for a
 * structured JSON response without over-spending on long prose.
 */
const SELF_HEALING_AGENT_CONFIG: AgentConfig = {
  role: 'Senior software engineer and technical diagnostician',
  goal: 'Diagnose failures and suggest precise fixes for autonomous retry',
  llm: { temperature: 0.1, maxTokens: 2000 },
  promptExtensions: [],
  tools: { builtin: [] },
};

export class SelfHealingAgent extends BaseLLMAgent {
  constructor() { super('self-healing-agent'); }

  /**
   * Produces a `SelfHealingDiagnosis` for the given failure context.
   *
   * Confidence-threshold semantics: the LLM emits its own confidence
   * score, then we DOWNGRADE `shouldRetry` to `false` when that
   * confidence is below the platform-admin's per-failure-type
   * threshold. So a diagnosis the LLM marked `shouldRetry: true,
   * confidence: low` against a `confidenceThreshold: medium`
   * setting will surface as `shouldRetry: false` — the LLM thinks
   * a retry is worth it, but the operator's policy says no.
   *
   * Never throws — LLM-call failure and parse failure both fall
   * through to a safe-default `shouldRetry: false, confidence: low`
   * diagnosis. `runSelfHealingLoop` depends on this for its
   * "NEVER throws" guarantee.
   */
  async diagnose(
    ctx: SelfHealingContext,
    correlationId: string,
    confidenceThreshold: 'high' | 'medium' | 'low' = 'medium',
  ): Promise<SelfHealingDiagnosis> {
    const prompt = this.buildDiagnosisPrompt(ctx);

    let raw: string;
    try {
      raw = await this.callLLM(prompt, SELF_HEALING_AGENT_CONFIG, correlationId);
    } catch (err) {
      log.warn(
        { err, correlationId, failureType: ctx.failureType },
        'SelfHealingAgent LLM call failed — returning safe-default',
      );
      return safeDefaultDiagnosis('LLM call failed');
    }

    const diagnosis = this.parseDiagnosis(raw);

    // Apply the per-failure-type confidence threshold: even if the
    // LLM says shouldRetry, downgrade when its own confidence is
    // below the operator's bar.
    if (
      CONFIDENCE_RANK[diagnosis.confidence] < CONFIDENCE_RANK[confidenceThreshold]
    ) {
      diagnosis.shouldRetry = false;
    }

    return diagnosis;
  }

  /**
   * BaseLLMAgent's template `run(task)` is not used — we expose
   * `diagnose(ctx, …)` instead because the input/output shapes
   * don't map onto the standard `AgentTask` / `AgentResult` pair.
   * These stubs satisfy the abstract method declarations.
   */
  protected buildPrompt(): string {
    throw new Error('SelfHealingAgent.buildPrompt is not used — call diagnose() directly');
  }

  protected parseResponse(): unknown {
    throw new Error('SelfHealingAgent.parseResponse is not used — call diagnose() directly');
  }

  private buildDiagnosisPrompt(ctx: SelfHealingContext): string {
    const sections = [
      `You are a senior software engineer diagnosing a failure in an automated code generation pipeline. Analyse the failure and determine if it can be fixed automatically.`,
      `## Original intent\n${ctx.intentText}`,
      buildFailureSection(ctx),
      buildSignalsSection(ctx.priorSignals),
      buildArtifactsSection(ctx.priorArtifactPaths),
      ctx.architectureMd
        ? `## Architecture\n${ctx.architectureMd.slice(0, 1500)}`
        : '',
      ctx.constraintRules ? `## Constraints\n${ctx.constraintRules}` : '',
      ctx.goldenPrinciples ? `## Golden principles\n${ctx.goldenPrinciples}` : '',
      `## Your task
Return ONLY a JSON object — no preamble, no markdown fences:
{
  "diagnosis": "What went wrong",
  "rootCause": "Underlying technical reason",
  "suggestedFix": "Specific actionable fix description",
  "updatedIntentText": "Reframed intent if needed (optional)",
  "confidence": "high|medium|low",
  "shouldRetry": true|false,
  "skipAgents": ["agent-roles whose output is fine and can be skipped"],
  "focusFiles": ["specific files that need regenerating"]
}

Set shouldRetry=false and confidence=low when:
- The failure is infrastructure/credentials — code cannot fix it
- You cannot determine the root cause from available context
- The same error has clearly appeared multiple times without progress`,
    ];
    return sections.filter(Boolean).join('\n\n');
  }

  private parseDiagnosis(raw: string): SelfHealingDiagnosis {
    try {
      const json = extractJsonObject(raw);
      const parsed = JSON.parse(json) as Partial<SelfHealingDiagnosis>;
      return {
        diagnosis: typeof parsed.diagnosis === 'string' ? parsed.diagnosis : 'Unknown failure',
        rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'Unknown',
        suggestedFix: typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix : 'Manual review required',
        updatedIntentText:
          typeof parsed.updatedIntentText === 'string' && parsed.updatedIntentText.trim() !== ''
            ? parsed.updatedIntentText
            : undefined,
        confidence: isConfidence(parsed.confidence) ? parsed.confidence : 'low',
        shouldRetry: typeof parsed.shouldRetry === 'boolean' ? parsed.shouldRetry : false,
        skipAgents: Array.isArray(parsed.skipAgents)
          ? parsed.skipAgents.filter((s): s is string => typeof s === 'string')
          : [],
        focusFiles: Array.isArray(parsed.focusFiles)
          ? parsed.focusFiles.filter((s): s is string => typeof s === 'string')
          : [],
      };
    } catch (err) {
      log.warn({ err }, 'SelfHealingAgent JSON parse failed — returning safe-default');
      return safeDefaultDiagnosis('parse failure');
    }
  }
}

function buildFailureSection(ctx: SelfHealingContext): string {
  const lines = [
    '## Failure details',
    `Type: ${ctx.failureType}`,
    `Summary: ${ctx.failureSummary}`,
  ];
  if (ctx.technicalDetail) {
    lines.push(`Technical detail: ${ctx.technicalDetail}`);
  }
  lines.push(`Attempt: ${ctx.attemptNumber}`);
  return lines.join('\n');
}

function buildSignalsSection(signals: ResumeSignal[]): string {
  if (signals.length === 0) {
    return '## Prior signals (0)\nNone';
  }
  return `## Prior signals (${signals.length})\n${signals
    .map((s) => `- [${s.type}/${s.severity}] ${s.sourceAgent}: ${s.message}`)
    .join('\n')}`;
}

function buildArtifactsSection(paths: string[]): string {
  const heading = '## Generated files before failure';
  if (paths.length === 0) {
    return `${heading}\nNone yet`;
  }
  return `${heading}\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

function isConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low';
}

function safeDefaultDiagnosis(reason: string): SelfHealingDiagnosis {
  return {
    diagnosis: `Could not produce a diagnosis — ${reason}`,
    rootCause: 'Unknown',
    suggestedFix: 'Manual review required',
    confidence: 'low',
    shouldRetry: false,
    skipAgents: [],
    focusFiles: [],
  };
}
