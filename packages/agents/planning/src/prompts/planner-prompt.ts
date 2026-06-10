/**
 * planner-prompt.ts — prompt builder for planner-agent.
 *
 * This file contains ONLY platform mechanics:
 *   - Role / goal framing (from agents.yaml)
 *   - Project context injection (feature, architecture, recommended
 *     phases)
 *   - Calls into `renderHarnessAgentRules` for HARNESS.json content
 *     (phaseScopingRules + rules)
 *   - The JSON response schema (platform contract)
 *
 * The phase scoping rules ("GOOD scope: ..." / "BAD scope: ...") come
 * from `HARNESS.json.agentConfig['planner-agent'].phaseScopingRules`
 * — they are NOT hardcoded here.
 */

import type { AgentConfig, HarnessConfig, FeatureRecord } from '@gestalt/core';
import { renderHarnessAgentRules } from '@gestalt/core';
import type { FeatureArchitecture } from '../types';

export function buildFeaturePlanPrompt(
  feature: FeatureRecord,
  architecture: FeatureArchitecture,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
  bounds: { maxPhases: number; maxFilesPerPhase: number },
): string {
  const harnessSection = renderHarnessAgentRules('planner-agent', harnessConfig);
  const extensions = agentCfg.promptExtensions ?? [];
  const recommendedPhases = architecture.recommendedPhases.length
    ? architecture.recommendedPhases.map((p, i) =>
        `  ${i + 1}. ${p.title} — ${p.rationale} (≈${p.estimatedFiles} files)`,
      ).join('\n')
    : '  (architecture-agent did not recommend specific phases)';

  // TR_037 — inject architecture-agent's full output as canonical
  // names. The planner-agent runs AFTER architecture-agent, but until
  // now the planner only saw entity names + module names; the
  // attributes + dependency map (where the canonical field/type
  // names live) were dropped. Result: the planner invented
  // alternative names (e.g. `LeaveStatus` / `CreateLeaveRequestDto`)
  // that diverged from architecture-agent's (`LeaveRequestStatus` /
  // `CreateLeaveRequestInput`), and downstream intent-agent caught
  // the mismatch + escalated. This block surfaces the full
  // architecture JSON so the planner has no excuse to rename. The
  // 2000-char slice keeps the prompt within budget; the essential
  // entity / module / dependency fields fit comfortably.
  const architectureJsonSlice = JSON.stringify(architecture, null, 2).slice(0, 2000);
  const canonicalNamesSection = [
    '## Canonical type and symbol names',
    '',
    'The architecture agent has already defined the following.',
    'You MUST use these exact names in all phase scopes.',
    'Do not rename, alias, or invent alternative names.',
    '',
    '```json',
    architectureJsonSlice,
    '```',
    '',
  ].join('\n');

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    canonicalNamesSection,
    harnessSection,
    '## Feature',
    `Title: ${feature.title}`,
    `Description: ${feature.description}`,
    '',
    '## Architecture (from architecture-agent)',
    `Domain entities: ${architecture.domainEntities.map((e) => e.name).join(', ') || '(none)'}`,
    `Modules: ${architecture.modules.map((m) => `${m.name} @ ${m.path}`).join(', ') || '(none)'}`,
    '',
    '### Recommended phases (architecture-agent)',
    recommendedPhases,
    '',
    '## Bounds',
    `- Maximum ${bounds.maxPhases} phases per feature.`,
    `- Maximum ${bounds.maxFilesPerPhase} files per phase. Prefer fewer.`,
    '- Each phase must be independently deployable through CI + the gate.',
    '- Phases must be ordered by dependency.',
    '',
    extensions.length
      ? '## Project-specific instructions\n' + extensions.map((e) => `- ${e}`).join('\n')
      : '',
    '',
    '## Task',
    'Decompose this feature into an ordered list of phases.',
    'Each phase must be a self-contained Aider-ready brief.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "phases": [',
    '    {',
    '      "title": "Create leave model",',
    '      "scope": "Create src/modules/leave/leave.model.ts. Define LeaveRequest, CreateLeaveRequestDto. Import LeaveType from src/shared/types/index.ts.",',
    '      "dependencies": [],',
    '      "architecture": "optional — short architectural note for this phase"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'If the feature is too large to fit in the bounds above, return',
    'fewer phases — never exceed the bounds.',
  ].filter(Boolean).join('\n');
}
