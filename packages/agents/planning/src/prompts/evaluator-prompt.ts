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
    `Default branch:   ${branchContext.defaultBranch}`,
    `Phase branch:     ${branchContext.phaseBranch ?? '(none — pr-agent did not persist a branch)'}`,
    `Merge commit SHA: ${branchContext.mergeCommitSha ?? '(none — adapter did not auto-merge, fall back to git diff)'}`,
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
    // TR_035 / ADR-057 (Part B2) — prefer the squash-merge SHA when
    // present. `git show --name-only --format= <sha>` returns the
    // exact file list from the merged commit, regardless of whether
    // the phase branch was deleted after merge. Fall back to the
    // diff path when the adapter didn't auto-merge.
    branchContext.mergeCommitSha
      ? `git show --name-only --format= ${branchContext.mergeCommitSha}`
      : branchContext.phaseBranch
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
    'For every NON-METADATA file the git diff shows added or modified',
    '(skip `.gestalt/`, `PLAN.md`, `docs/ARCHITECTURE.md`), also use',
    '`readFile` to inspect it and extract its KEY EXPORTS — the type,',
    'interface, class, function, and const names other phases would',
    'import. Put these in `builtFiles`. This populates PLAN.md\'s',
    '"What has been built" section so the next phase\'s Aider knows',
    'exactly what exists on disk and what it can import.',
    '',
    'You MUST run `executeScript` with the git diff command above',
    'BEFORE writing your JSON response. Do not assume the diff result;',
    'run it. If you skip the tool call, your verdict is unsupported.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences.',
    'Schema (fill the values from your actual tool-call output — do',
    'NOT copy the placeholder strings verbatim):',
    '',
    '```json',
    '{',
    '  "verdict": "<success | partial | escalate>",',
    '  "summary": "<one-line verdict, quote the git diff output you ran>",',
    '  "adjustments": [',
    '    {',
    '      "phaseTitle": "<title of a remaining phase that needs updating>",',
    '      "updatedScope": "<patched scope reflecting actual file paths>",',
    '      "updatedDependencies": ["<dep1>", "<dep2>"],',
    '      "reason": "<what actually happened that motivated the change>"',
    '    }',
    '  ],',
    '  "builtFiles": [',
    '    {',
    '      "path": "<relative path of a file your git diff showed>",',
    '      "exports": ["<export-kind ExportName>", "<...>"]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'When no adjustments are needed, return `"adjustments": []`.',
    'When the verdict is `"escalate"`, leave `adjustments` empty.',
    'If the phase wrote no source files (only `.gestalt/` metadata),',
    'return `"builtFiles": []`.',
  ].filter(Boolean).join('\n');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 400);
}
