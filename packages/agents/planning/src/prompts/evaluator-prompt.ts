/**
 * evaluator-prompt.ts — prompt builder for phase-evaluator-agent.
 *
 * This file contains ONLY platform mechanics:
 *   - Role / goal framing (from agents.yaml)
 *   - Project context injection (feature, phase, deployed artifacts,
 *     remaining phases)
 *   - Calls into `renderHarnessAgentRules` for HARNESS.json content
 *     (evaluationCriteria + rules)
 *   - The JSON response schema (platform contract)
 *
 * Evaluation criteria ("Success: ..." / "Escalate: ...") come from
 * `HARNESS.json.agentConfig['phase-evaluator-agent'].evaluationCriteria`
 * — they are NOT hardcoded here.
 */

import type {
  AgentConfig, HarnessConfig, FeatureRecord, FeaturePhaseRecord,
} from '@gestalt/core';
import { renderHarnessAgentRules } from '@gestalt/core';

export function buildPhaseEvaluationPrompt(
  feature: FeatureRecord,
  completedPhase: FeaturePhaseRecord,
  builtFilePaths: string[],
  remainingPhases: FeaturePhaseRecord[],
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  const harnessSection = renderHarnessAgentRules('phase-evaluator-agent', harnessConfig);
  const extensions = agentCfg.promptExtensions ?? [];
  const builtBlock = builtFilePaths.length
    ? builtFilePaths.map((p) => `  - ${p}`).join('\n')
    : '  (no file paths reported)';
  const remainingBlock = remainingPhases.length
    ? remainingPhases.map((p, i) =>
        `  ${i + 1}. ${p.title} — ${oneLine(p.scope)}`,
      ).join('\n')
    : '  (this was the last phase)';

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    '## Feature',
    `Title: ${feature.title}`,
    '',
    '## Phase just completed',
    `Title: ${completedPhase.title}`,
    `Planned scope: ${oneLine(completedPhase.scope)}`,
    '',
    '### Files actually built in this phase',
    builtBlock,
    '',
    '## Remaining phases (not yet started)',
    remainingBlock,
    '',
    extensions.length
      ? '## Project-specific instructions\n' + extensions.map((e) => `- ${e}`).join('\n')
      : '',
    '',
    '## Task',
    'Evaluate the completed phase against its plan. Compare the built',
    'files against what was planned. If the built code differs from',
    'the plan but is still correct, that is acceptable — adjust the',
    'remaining phases instead of failing the verdict.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "verdict": "success" | "partial" | "escalate",',
    '  "summary": "one-line overall verdict",',
    '  "adjustments": [',
    '    {',
    '      "phaseTitle": "Title of a REMAINING phase that needs updating",',
    '      "updatedScope": "patched scope reflecting actual file paths",',
    '      "updatedDependencies": ["..."],',
    '      "reason": "what actually happened that motivated the change"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'When no adjustments are needed, return `"adjustments": []`.',
    'When the verdict is `"escalate"`, leave `adjustments` empty.',
  ].filter(Boolean).join('\n');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 400);
}
