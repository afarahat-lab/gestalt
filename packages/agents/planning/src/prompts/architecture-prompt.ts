/**
 * architecture-prompt.ts — prompt builder for architecture-agent.
 *
 * This file contains ONLY platform mechanics:
 *   - Role / goal framing (from agents.yaml)
 *   - Project context injection (architecture.md, feature, prior phases)
 *   - Calls into `renderHarnessAgentRules` for HARNESS.json content
 *   - The JSON response schema (platform contract)
 *
 * It must NOT contain any guidance text describing HOW to design or
 * WHAT a good design looks like. All such guidance lives in
 * `HARNESS.json.agentConfig['architecture-agent'].architectureGuidance`
 * + `agents.yaml`'s `prompt_extensions`.
 */

import type { AgentConfig, HarnessConfig, FeatureRecord, FeaturePhaseRecord } from '@gestalt/core';
import { renderHarnessAgentRules } from '@gestalt/core';
import type { FeatureArchitecture } from '../types';

/**
 * TR_038 — Render the project's declared stack from
 * `HARNESS.json.stack` as a markdown section the architecture-agent
 * reads BEFORE the task description. The agent uses this to specify
 * concrete implementations (`pg` Pool, Express handler, …) for every
 * interface or abstraction it emits, rather than leaving the choice
 * open for a developer to ask about.
 *
 * Platform mechanics per ADR-042 — the rule telling the agent to
 * USE the stack lives in
 * `HARNESS.json.agentConfig['architecture-agent'].architectureGuidance`;
 * the stack VALUES live in `HARNESS.json.stack`. This function only
 * surfaces what is already declared elsewhere.
 *
 * Returns empty string when `HARNESS.json.stack` is absent — callers
 * test `length > 0` and omit the section cleanly.
 */
function renderStackSection(harnessConfig: HarnessConfig | null): string {
  const stack = harnessConfig?.stack;
  if (!stack || Object.keys(stack).length === 0) return '';
  return [
    '## Project stack',
    '',
    'Use the following declared stack to specify concrete',
    'implementations for every interface or abstraction',
    'you define. Do not leave implementation choices open.',
    '',
    '```json',
    JSON.stringify(stack, null, 2),
    '```',
    '',
  ].join('\n');
}

/**
 * Build the feature-level architecture prompt — high-level domain
 * entities, module list, dependency direction, recommended phase
 * sequence. Consumed by `architecture-agent.designFeature()`.
 */
export function buildFeatureArchitecturePrompt(
  feature: FeatureRecord,
  existingArchitectureMd: string,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const archExcerpt = existingArchitectureMd.slice(0, 3000);
  const extensions = agentCfg.promptExtensions ?? [];

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    '## Existing project architecture (docs/ARCHITECTURE.md, truncated to 3000 chars)',
    archExcerpt || '(no existing architecture file)',
    '',
    '## Feature to design',
    `Title: ${feature.title}`,
    '',
    'Description:',
    feature.description,
    '',
    extensions.length
      ? '## Project-specific instructions\n' + extensions.map((e) => `- ${e}`).join('\n')
      : '',
    '',
    '## Task',
    'Produce a high-level architectural design for this feature only.',
    'Do not include implementation details — those come in the per-phase designs.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "domainEntities": [',
    '    { "name": "...", "attributes": ["..."], "purpose": "..." }',
    '  ],',
    '  "modules": [',
    '    { "name": "...", "path": "src/modules/...", "owns": ["..."] }',
    '  ],',
    '  "dependencyMap": [',
    '    { "from": "...", "to": "..." }',
    '  ],',
    '  "recommendedPhases": [',
    '    { "title": "...", "rationale": "...", "estimatedFiles": 3 }',
    '  ],',
    '  "architectureMdUpdate": "markdown to append to ARCHITECTURE.md"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}

/**
 * Build the per-phase architecture prompt — exact interface
 * signatures, import paths, and success criteria for one phase only.
 * Consumed by `architecture-agent.designPhase()` and emitted before
 * the planner-agent's scope is finalised for the phase.
 */
export function buildPhaseArchitecturePrompt(
  feature: FeatureRecord,
  phaseTitle: string,
  phaseRationale: string,
  featureArchitecture: string,
  priorPhases: FeaturePhaseRecord[],
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const extensions = agentCfg.promptExtensions ?? [];
  const priorPhasesBlock = priorPhases.length
    ? priorPhases.map((p, i) => `  ${i + 1}. ${p.title} (${p.status}) — ${oneLine(p.scope)}`).join('\n')
    : '  (none — this is the first phase)';

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    '## Feature',
    `Title: ${feature.title}`,
    `Description: ${oneLine(feature.description)}`,
    '',
    '## High-level architecture (from feature design)',
    featureArchitecture.slice(0, 3000) || '(no high-level architecture available)',
    '',
    '## Prior phases (already in the plan)',
    priorPhasesBlock,
    '',
    '## Phase to design',
    `Title: ${phaseTitle}`,
    `Rationale: ${phaseRationale}`,
    '',
    extensions.length
      ? '## Project-specific instructions\n' + extensions.map((e) => `- ${e}`).join('\n')
      : '',
    '',
    '## Task',
    'Produce the focused technical design for THIS PHASE ONLY.',
    'Reference only files that already exist OR files this phase creates.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "interfaces": [',
    '    "interface LeaveRequest { id: string; ... }"',
    '  ],',
    '  "importStatements": [',
    '    "import { Pool } from \\"src/shared/db/connection\\""',
    '  ],',
    '  "sqlSchema": "CREATE TABLE leave_requests (...)",',
    '  "successCriteria": [',
    '    "src/modules/leave/leave.model.ts exists and exports LeaveRequest"',
    '  ]',
    '}',
    '```',
    '',
    'Omit `sqlSchema` when the phase has no SQL changes.',
  ].filter(Boolean).join('\n');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * TR_038 — Architecture review prompt. The architecture-agent emits
 * a draft feature architecture; this prompt asks the SAME agent to
 * re-read its draft and check completeness / consistency / ambiguity
 * / feasibility before the planner is allowed to read the design.
 *
 * STOPGAP (ADR-056): A single-agent self-review is a lightweight
 * stand-in for the architecture crew (domain + data + application
 * architects deliberating in parallel under a chief-architect
 * supervisor) that the LangGraph migration will introduce. Delete
 * this builder + `ArchitectureAgent.reviewDesign()` + the
 * orchestrator call site when the crew lands.
 *
 * The review returns the SAME JSON schema as the original design
 * (`FeatureArchitecture`) — not a delta. On parse failure the
 * caller returns the original draft unchanged so the pipeline is
 * never blocked on a review-only error.
 */
export function buildArchitectureReviewPrompt(
  draft: FeatureArchitecture,
  feature: FeatureRecord,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const draftJson = JSON.stringify(draft, null, 2).slice(0, 3000);

  // TR_040 — stack compliance gate. The review pass becomes an
  // enforcement step: any framework reference in the draft that
  // doesn't match `HARNESS.stack` must be corrected before the
  // reviewed JSON is returned. Empty string when no stack is
  // declared — the check is skipped cleanly.
  const stack = harnessConfig?.stack;
  const stackComplianceCheck =
    stack && Object.keys(stack).length > 0
      ? [
          '## Stack compliance check',
          '',
          'The following stack is declared for this project:',
          '```json',
          JSON.stringify(stack, null, 2),
          '```',
          '',
          'Before returning, verify:',
          '- Every framework reference matches the declared stack.',
          '- No alternative frameworks appear in success criteria,',
          '  interface names, or implementation notes.',
          '- If you find any mismatch, correct it in your output.',
          '',
        ].join('\n')
      : '';

  return [
    `You are ${agentCfg.role} performing a design review.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    '## Draft architecture to review',
    '```json',
    draftJson,
    '```',
    '',
    '## Feature description',
    feature.description,
    '',
    '## Your review task',
    'Review the draft architecture above for:',
    '1. Completeness — every interface has a concrete implementation backed by the declared project stack.',
    '2. Consistency — symbol names (types, interfaces, modules) are consistent throughout the design.',
    '3. Ambiguity — no open questions a developer would need to ask before implementing.',
    '4. Feasibility — the design can be implemented with the declared stack.',
    '',
    'If the draft is complete and correct, return it unchanged.',
    'If it has gaps, fix them and return the corrected version.',
    'Return the COMPLETE architecture JSON — not just the changes.',
    '',
    stackComplianceCheck,
    'Return ONLY a single JSON object — no preamble, no markdown fences — in the same schema as the input:',
    '',
    '```json',
    '{',
    '  "domainEntities": [',
    '    { "name": "...", "attributes": ["..."], "purpose": "..." }',
    '  ],',
    '  "modules": [',
    '    { "name": "...", "path": "src/modules/...", "owns": ["..."] }',
    '  ],',
    '  "dependencyMap": [',
    '    { "from": "...", "to": "..." }',
    '  ],',
    '  "recommendedPhases": [',
    '    { "title": "...", "rationale": "...", "estimatedFiles": 3 }',
    '  ],',
    '  "architectureMdUpdate": "markdown to append to ARCHITECTURE.md"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}
