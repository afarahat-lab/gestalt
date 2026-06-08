/**
 * evaluator-prompt.ts — prompt builder for phase-evaluator-agent.
 *
 * This file contains ONLY platform mechanics:
 *   - Role / goal framing (from agents.yaml)
 *   - Branch-name context (the agent uses git itself to read diffs)
 *   - Calls into `renderHarnessAgentRules` for HARNESS.json content
 *     (rules + evaluationCriteria)
 *   - The JSON response schema (platform contract)
 *
 * TR_026 — the platform NO LONGER pre-computes the list of files
 * the phase wrote. Per ADR-050 that's the agent's job: it has
 * `executeScript` in its tool set and runs `git diff` against the
 * branches the orchestrator passes here. Evaluation criteria
 * ("Success: ..." / "Escalate: ...") still come from
 * `HARNESS.json.agentConfig['phase-evaluator-agent']` — not hardcoded.
 */

import type {
  AgentConfig, HarnessConfig, FeatureRecord, FeaturePhaseRecord,
} from '@gestalt/core';
import { renderHarnessAgentRules } from '@gestalt/core';
import type { PhaseBranchContext } from '../agents/phase-evaluator-agent';

export function buildPhaseEvaluationPrompt(
  feature: FeatureRecord,
  completedPhase: FeaturePhaseRecord,
  branchContext: PhaseBranchContext,
  remainingPhases: FeaturePhaseRecord[],
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  const harnessSection = renderHarnessAgentRules('phase-evaluator-agent', harnessConfig);
  const extensions = agentCfg.promptExtensions ?? [];
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
    '## Branch context (for your git diff)',
    `Default branch: ${branchContext.defaultBranch}`,
    `Phase branch:   ${branchContext.phaseBranch ?? '(none — pr-agent did not persist a branch)'}`,
    '',
    '## Remaining phases (not yet started)',
    remainingBlock,
    '',
    extensions.length
      ? '## Project-specific instructions\n' + extensions.map((e) => `- ${e}`).join('\n')
      : '',
    '',
    '## Task',
    'You have `executeScript` available. Use it to run git against the',
    'cloned working directory and discover what the phase actually built.',
    'A typical command:',
    '',
    '```sh',
    branchContext.phaseBranch
      ? `git diff origin/${branchContext.defaultBranch}...origin/${branchContext.phaseBranch} --name-status`
      : `git log -1 --name-status origin/${branchContext.defaultBranch}`,
    '```',
    '',
    'Read the output and decide:',
    '- If git shows files matching the phase scope AND they meet the',
    '  success criteria → verdict: "success".',
    '- If git shows files that differ from the plan but are still',
    '  correct → verdict: "partial" and emit adjustments for the',
    '  remaining phases.',
    '- If git shows zero files (e.g. Aider exited cleanly but wrote',
    '  nothing) OR shows files unrelated to the phase scope →',
    '  verdict: "escalate".',
    '',
    'Quote the git output (or a representative snippet) in the',
    '`summary` field so operators can see your evidence.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "verdict": "success" | "partial" | "escalate",',
    '  "summary": "one-line overall verdict, citing git evidence",',
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
