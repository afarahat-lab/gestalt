/**
 * Context assembler — builds the ContextSnapshot delivered to each agent.
 *
 * Reads the harness state at dispatch time and adds prior artifacts
 * from upstream agents in the current cycle.
 *
 * Agents never read files directly — they consume the snapshot.
 */

import type { ContextSnapshot, ExecutionPlan, GeneratedArtifact, IntentSpec } from '../types';
import { createHarnessEngine } from '@gestalt/core';
import { getPriorArtifacts } from './plan-builder';
import type { AgentRole } from '@gestalt/core';
import { loadAgentConfig } from '../config/agent-config-loader';

/**
 * Assembles a ContextSnapshot for the given agent role.
 * Reads context files from the project harness and injects
 * all prior artifacts from the current execution plan.
 *
 * `intentText` is the operator's original intent string (`payload.text` on
 * the BullMQ message). It is always populated on the snapshot's
 * `intentSpec.rawIntent` so the intent-agent's prompt sees the real
 * request even before any agent has produced an IntentSpec artifact. For
 * downstream agents whose `intentSpec.rawIntent` came from the persisted
 * artifact, the value is preserved; the operator's text is used as a
 * fallback if the artifact's rawIntent is empty.
 */
export async function assembleContext(
  projectRoot: string,
  plan: ExecutionPlan,
  forAgent: AgentRole,
  intentText: string,
): Promise<ContextSnapshot> {
  const engine = createHarnessEngine(projectRoot);
  const baseSnapshot = await engine.buildSnapshot(plan.correlationId);

  // Collect artifacts from all completed upstream steps
  const priorStepResults = getPriorArtifacts(plan, forAgent);
  const priorArtifacts: GeneratedArtifact[] = priorStepResults
    .flatMap((r) => r?.artifacts ?? []);

  // Extract IntentSpec from prior artifacts if intent-agent has run
  const intentSpecArtifact = priorArtifacts.find(
    (a) => a.path === '.gestalt/intent-spec.json',
  );

  const parsedSpec = intentSpecArtifact
    ? safeParseJson(intentSpecArtifact.content) as IntentSpec | null
    : null;

  const baseSpec = parsedSpec ?? buildEmptyIntentSpec(plan.correlationId);
  const intentSpec: IntentSpec = {
    ...baseSpec,
    rawIntent: baseSpec.rawIntent?.trim() ? baseSpec.rawIntent : intentText,
  };

  // Load per-agent config from `agents.yaml` (Step 1 of agent
  // externalisation). The loader never throws — absent / malformed
  // files resolve to defaults — so existing projects keep working
  // identically without an agents.yaml committed.
  const agentConfig = await loadAgentConfig(projectRoot, forAgent);

  return {
    projectRoot,
    harness: baseSnapshot.harness as ContextSnapshot['harness'],
    architectureMd: baseSnapshot.architectureMd,
    domainMd: baseSnapshot.domainMd,
    architecture: parseArchitecture(baseSnapshot.architectureMd),
    domain: parseDomain(baseSnapshot.domainMd),
    goldenPrinciples: parseGoldenPrinciples(baseSnapshot.goldenPrinciplesMd),
    relevantDecisions: parseDecisions(baseSnapshot.relevantDecisions),
    intentSpec,
    priorArtifacts,
    agentConfig,
  };
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
// These convert Markdown content into structured types agents can reason over.
// Phase 2: replace with proper AST-based parsers. For now: extract key sections.

function parseArchitecture(md: string): ContextSnapshot['architecture'] {
  return {
    style: extractMarkdownValue(md, 'style') as ContextSnapshot['architecture']['style']
      ?? 'modular-monolith',
    layers: extractListItems(md, 'layers'),
    dependencyRules: [],
    modules: extractListItems(md, 'modules'),
  };
}

function parseDomain(md: string): ContextSnapshot['domain'] {
  return {
    entities: extractEntities(md),
    boundedContexts: extractListItems(md, 'bounded contexts'),
  };
}

function parseGoldenPrinciples(md: string): ContextSnapshot['goldenPrinciples'] {
  // Extract ## GP-NNN sections
  const matches = [...md.matchAll(/^## (GP-\d+) — (.+)\n+([\s\S]+?)(?=^## |$)/gm)];
  return matches.map((m) => ({
    id: m[1],
    title: m[2].trim(),
    description: m[3].trim().split('\n')[0] ?? '',
    enforcement: extractMarkdownValue(m[3], 'enforcement') ?? '',
  }));
}

function parseDecisions(md: string): ContextSnapshot['relevantDecisions'] {
  // Extract ## ADR-NNN sections — simplified
  const matches = [...md.matchAll(/^## ADR-(\d+) — (.+)\n+([\s\S]+?)(?=^## ADR-|$)/gm)];
  return matches.slice(-10).map((m) => ({  // keep last 10 ADRs
    id: `ADR-${m[1]}`,
    title: m[2].trim(),
    status: 'accepted' as const,
    decision: extractMarkdownValue(m[3], 'decision') ?? m[3].split('\n')[0] ?? '',
    affectedDomains: [],
  }));
}

function extractEntities(md: string): ContextSnapshot['domain']['entities'] {
  const entities: ContextSnapshot['domain']['entities'] = [];
  // Find lines like `- EntityName` or `- **EntityName**`
  const matches = [...md.matchAll(/^[-*]\s+\*{0,2}([A-Z][a-zA-Z]+)\*{0,2}/gm)];
  for (const m of matches) {
    if (m[1] && !entities.find((e) => e.name === m[1])) {
      entities.push({ name: m[1], fields: [], relationships: [] });
    }
  }
  return entities;
}

function extractListItems(md: string, sectionName: string): string[] {
  const sectionRegex = new RegExp(`## ${sectionName}[\\s\\S]+?(?=^## |$)`, 'im');
  const section = sectionRegex.exec(md)?.[0] ?? '';
  return [...section.matchAll(/^[-*]\s+(.+)/gm)].map((m) => m[1].trim());
}

function extractMarkdownValue(md: string, key: string): string | undefined {
  const regex = new RegExp(`\\*{0,2}${key}\\*{0,2}[:\\s]+(.+)`, 'im');
  return regex.exec(md)?.[1]?.trim();
}

function safeParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildEmptyIntentSpec(correlationId: string): ContextSnapshot['intentSpec'] {
  return {
    id: '',
    correlationId,
    rawIntent: '',
    scope: { affectedDomains: [], affectedLayers: [], isBreakingChange: false, estimatedComplexity: 'medium' },
    successCriteria: [],
    constraints: [],
    outOfScope: [],
    ambiguities: [],
  };
}
