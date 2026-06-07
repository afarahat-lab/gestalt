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
  const archExcerpt = existingArchitectureMd.slice(0, 3000);
  const extensions = agentCfg.promptExtensions ?? [];

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
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
  const extensions = agentCfg.promptExtensions ?? [];
  const priorPhasesBlock = priorPhases.length
    ? priorPhases.map((p, i) => `  ${i + 1}. ${p.title} (${p.status}) — ${oneLine(p.scope)}`).join('\n')
    : '  (none — this is the first phase)';

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
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
