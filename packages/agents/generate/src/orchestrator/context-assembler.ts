/**
 * Context assembler — builds the ContextSnapshot delivered to each agent.
 *
 * Reads the harness state at dispatch time and adds prior artifacts
 * from upstream agents in the current cycle.
 *
 * Agents never read files directly — they consume the snapshot.
 */

import type {
  ContextSnapshot, ExecutionPlan, FeedbackSignal, GeneratedArtifact, IntentSpec,
  ResumeContextSnapshot,
} from '../types';
import { createHarnessEngine, getRepositories } from '@gestalt/core';
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
  priorSignals: FeedbackSignal[] = [],
  intentId?: string,
): Promise<ContextSnapshot> {
  const engine = createHarnessEngine(projectRoot);
  const baseSnapshot = await engine.buildSnapshot(plan.correlationId);

  // Collect artifacts from all completed upstream steps
  const priorStepResults = getPriorArtifacts(plan, forAgent);
  const priorArtifacts: GeneratedArtifact[] = priorStepResults
    .flatMap((r) => r?.artifacts ?? []);

  // Extract IntentSpec from prior artifacts if intent-agent has run
  const intentSpecArtifact = priorArtifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/intent-spec.json'),
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

  // Migration 020 — read the most recent resume context from the
  // intent row so prompts can render their "Resumed attempt" section
  // AND the orchestrator can honour `skipAgents` for high-confidence
  // auto-healed retries. Falls back to undefined when no intentId is
  // supplied (e.g. legacy callers); the snapshot's optional fields
  // default to absent.
  let resumeContext: ResumeContextSnapshot | null | undefined;
  let resumePriorSignals: FeedbackSignal[] | null = null;
  if (intentId) {
    try {
      const intent = await getRepositories().intents.findById(intentId);
      resumeContext = (intent?.lastResumeContext ?? null) as ResumeContextSnapshot | null;
      // When the cycle is a resume (autoHealed OR operator-feedback)
      // the resume context's priorSignals may include signals the
      // orchestrator wouldn't otherwise have routed yet. Layer them
      // into `priorSignals` so the prompt's signal-feedback section
      // reflects the historical record.
      if (resumeContext && resumeContext.priorSignals?.length && priorSignals.length === 0) {
        resumePriorSignals = resumeContext.priorSignals.map((s) => ({
          id: crypto.randomUUID(),
          correlationId: plan.correlationId,
          type: s.type as FeedbackSignal['type'],
          severity: s.severity as FeedbackSignal['severity'],
          sourceAgent: s.sourceAgent as FeedbackSignal['sourceAgent'],
          message: s.message,
          autoResolvable: true,
          createdAt: new Date(),
        }));
      }
    } catch {
      // Non-fatal — assembly continues without resume context.
    }
  }

  return {
    projectRoot,
    harness: baseSnapshot.harness as ContextSnapshot['harness'],
    architectureMd: baseSnapshot.architectureMd,
    domainMd: baseSnapshot.domainMd,
    // TEST_REPORT_002 Fix 7 — surface AGENTS.md so the code-agent
    // (and any future agent that wants project conventions) can
    // render it into its prompt without an extra readFile tool call.
    agentsMd: baseSnapshot.agentsMd,
    architecture: parseArchitecture(baseSnapshot.architectureMd),
    domain: parseDomain(baseSnapshot.domainMd),
    goldenPrinciples: parseGoldenPrinciples(baseSnapshot.goldenPrinciplesMd),
    relevantDecisions: parseDecisions(baseSnapshot.relevantDecisions),
    intentSpec,
    priorArtifacts,
    priorSignals: resumePriorSignals ?? priorSignals,
    agentConfig,
    resumeContext: resumeContext ?? undefined,
    focusFiles: resumeContext?.focusFiles ?? undefined,
    skipAgents: resumeContext?.skipAgents ?? undefined,
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
