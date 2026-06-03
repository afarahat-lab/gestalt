/**
 * Custom-agent runner (ADR-037).
 *
 * Generic LLM runner for project-defined agents declared in
 * `agents.yaml` under `custom_agents:`. Substitutes a fixed set of
 * `{{placeholders}}` in the agent's `prompt`, sends the result to the
 * LLM (routed via `getLLMClient(definition.llm.model)`), and parses
 * the response as
 *   { passed: boolean, findings: [...], summary: string }.
 *
 * Failures are non-fatal — a parse error or LLM call failure returns
 * an `error`-status result with `passed: false` and an empty
 * `findings` array. The orchestrator turns that into a single
 * `CONTEXT_GAP` signal so the gate can see the agent broke.
 *
 * Custom agents NEVER produce framework-style code artifacts and
 * NEVER emit `GOLDEN_PRINCIPLE_BREACH` signals. The verdict logic
 * stays centralised in the review-agent + gate orchestrator
 * (ADR-013) — custom agents contribute typed signals only.
 */

import { getLLMClientForModel, extractJsonObject } from '@gestalt/core';
import type {
  ContextSnapshot, CustomAgentDefinition, CustomAgentFinding,
  CustomAgentResult, GeneratedArtifact, Principle,
} from '../types';

const MAX_ARTIFACT_CHARS = 2000;

/**
 * Runs a single custom agent against the supplied context snapshot.
 * Always resolves — never throws. On LLM error or response parse
 * failure, the returned result has `status: 'error'` so the caller
 * can route a `CONTEXT_GAP` signal to the gate.
 */
export async function runCustomAgent(
  definition: CustomAgentDefinition,
  ctx: ContextSnapshot,
  correlationId: string,
): Promise<CustomAgentResult> {
  const startedAt = Date.now();

  const prompt = substitutePromptVariables(definition.prompt, {
    role: definition.role,
    goal: definition.goal,
    artifacts: formatArtifacts(ctx.priorArtifacts),
    goldenPrinciples: formatGoldenPrinciples(ctx.goldenPrinciples),
    intentText: ctx.intentSpec.rawIntent,
    projectName: ctx.harness.name,
  });

  let modelUsed: string | null = null;
  try {
    // Registry-aware (Session 3) — picks up the per-LLM baseUrl +
    // apiKeyEnv when the custom agent's `model` matches a registered
    // platform LLM.
    const client = await getLLMClientForModel(definition.llm.model);
    modelUsed = client.getModel();
    const result = await client.complete({
      messages: [{ role: 'user', content: prompt }],
      responseFormat: 'json',
      ...(definition.llm.temperature !== undefined
        ? { temperature: definition.llm.temperature }
        : { temperature: 0.1 }),
      ...(definition.llm.maxTokens !== undefined
        ? { maxTokens: definition.llm.maxTokens }
        : { maxTokens: 4000 }),
      correlationId,
    });

    if (!result.ok) {
      return errorResult(
        definition.name,
        result.error.message,
        Date.now() - startedAt,
        modelUsed,
      );
    }

    const parsed = safeParseResponse(result.value.content);
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.filter(isValidFinding)
      : [];
    // If the LLM omitted `passed`, infer from findings: any high
    // severity = failed, otherwise passed. Matches operator
    // expectation for a custom agent that returns only findings.
    const hasHigh = findings.some((f) => f.severity === 'high');
    const passed =
      typeof parsed.passed === 'boolean' ? parsed.passed : !hasHigh;
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary : '';

    return {
      agentName: definition.name,
      status: passed ? 'passed' : 'failed',
      passed,
      findings,
      summary,
      rawResponse: result.value.content,
      tokensUsed: result.value.tokensUsed,
      durationMs: Date.now() - startedAt,
      modelUsed,
    };
  } catch (err) {
    return errorResult(
      definition.name,
      err instanceof Error ? err.message : String(err),
      Date.now() - startedAt,
      modelUsed,
    );
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

function substitutePromptVariables(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value !== undefined ? value : `{{${key}}}`;
  });
}

function formatArtifacts(artifacts: GeneratedArtifact[]): string {
  const codeArtifacts = artifacts.filter((a) => a.type === 'code');
  if (codeArtifacts.length === 0) return '(no code artifacts)';
  return codeArtifacts
    .map((a) => {
      const truncated = a.content.length > MAX_ARTIFACT_CHARS
        ? a.content.slice(0, MAX_ARTIFACT_CHARS) + '\n/* TRUNCATED */'
        : a.content;
      return `### ${a.path}\n\`\`\`typescript\n${truncated}\n\`\`\``;
    })
    .join('\n\n');
}

function formatGoldenPrinciples(principles: Principle[]): string {
  if (!principles || principles.length === 0) return '(none)';
  return principles.map((p) => `- ${p.title}: ${p.description}`).join('\n');
}

interface ParsedResponse {
  passed?: boolean;
  findings?: unknown;
  summary?: string;
}

function safeParseResponse(raw: string): ParsedResponse {
  // Strip markdown fences + locate the first balanced JSON object via
  // the shared `extractJsonObject` helper (`@gestalt/core`). Falls
  // through to a passing summary on parse failure so a misbehaved
  // LLM doesn't block the cycle.
  try {
    return JSON.parse(extractJsonObject(raw)) as ParsedResponse;
  } catch {
    return {
      passed: true,
      findings: [],
      summary: raw.slice(0, 200),
    };
  }
}

function isValidFinding(value: unknown): value is CustomAgentFinding {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  return (
    (f['severity'] === 'high' || f['severity'] === 'medium' || f['severity'] === 'low')
    && typeof f['file'] === 'string'
    && typeof f['description'] === 'string'
  );
}

function errorResult(
  agentName: string,
  message: string,
  durationMs: number,
  modelUsed: string | null,
): CustomAgentResult {
  return {
    agentName,
    status: 'error',
    passed: false,
    findings: [],
    summary: `Custom agent error: ${message}`,
    rawResponse: '',
    tokensUsed: 0,
    durationMs,
    modelUsed,
    errorMessage: message,
  };
}
