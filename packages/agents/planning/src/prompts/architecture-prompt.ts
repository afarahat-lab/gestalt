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
import type { FeatureArchitecture, PhaseArchitecture } from '../types';

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
/**
 * TR_044 — Render the project's `docs/GOLDEN_PRINCIPLES.md` content
 * as a markdown section the architecture-agent reads BEFORE
 * designing or reviewing. Closes the TR_042 gap where intent-agent
 * escalated on cross-cutting concerns (audit logging, etc.) the
 * architecture-agent had never been told about — intent-agent reads
 * the project's goldenPrinciples but the architecture-agent did not.
 *
 * Truncated to 3000 chars to keep the prompt within budget; the
 * agent can `readFile` the full version if it needs more.
 *
 * Returns empty string when the project has no
 * `docs/GOLDEN_PRINCIPLES.md` — callers test `length > 0` and omit
 * the section cleanly.
 */
function renderGoldenPrinciplesSection(goldenPrinciplesMd: string): string {
  const trimmed = goldenPrinciplesMd.trim();
  if (trimmed.length === 0) return '';
  return [
    '## Project golden principles (cross-cutting concerns)',
    '',
    'These project-wide rules govern every feature. Account for',
    'them in your design — every interface, phase, and success',
    'criterion you emit must satisfy these principles or include',
    'a phase that fulfils them. Intent-agent and review-agent both',
    'read the same principles and will flag any feature that',
    'leaves a principle unaddressed.',
    '',
    trimmed.slice(0, 3000),
    '',
  ].join('\n');
}

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
  goldenPrinciplesMd: string = '',
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const goldenPrinciplesSection = renderGoldenPrinciplesSection(goldenPrinciplesMd);
  const archExcerpt = existingArchitectureMd.slice(0, 3000);
  const extensions = agentCfg.promptExtensions ?? [];

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    goldenPrinciplesSection,
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
  goldenPrinciplesMd: string = '',
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const goldenPrinciplesSection = renderGoldenPrinciplesSection(goldenPrinciplesMd);
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
    goldenPrinciplesSection,
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
  goldenPrinciplesMd: string = '',
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const goldenPrinciplesSection = renderGoldenPrinciplesSection(goldenPrinciplesMd);
  const draftJson = JSON.stringify(draft, null, 2).slice(0, 3000);

  // TR_040 → TR_041 — stack compliance gate. The review pass
  // becomes an enforcement step: any framework reference in the
  // draft that doesn't match `HARNESS.stack` must be corrected
  // before the reviewed JSON is returned. Empty string when no
  // stack is declared — the check is skipped cleanly.
  //
  // TR_041 Fix 1: this section is rendered FIRST in the prompt
  // — before the persona, before the draft, before the feature
  // description. The TR_040 placement (just before the JSON
  // schema, after the review task) failed to override
  // chat-latest's Vitest bias even though the rule was present.
  // Pre-conditioning the LLM on the stack BEFORE it reads the
  // draft is the strongest position in the prompt.
  const stack = harnessConfig?.stack;
  const stackComplianceCheck =
    stack && Object.keys(stack).length > 0
      ? [
          '## Stack compliance check (read this first)',
          '',
          'The following stack is declared for this project. It is',
          'the authoritative source for every framework, library,',
          'and tool choice in the architecture you are about to',
          'review. You MUST treat any deviation in the draft below',
          'as a defect that you correct before returning.',
          '',
          '```json',
          JSON.stringify(stack, null, 2),
          '```',
          '',
          'Before returning:',
          '- Verify every framework reference matches the declared stack.',
          '- No alternative frameworks may appear in success criteria,',
          '  interface names, implementation notes, or recommended-phase',
          '  titles.',
          '- If you find any mismatch, REWRITE the relevant field with',
          '  the declared stack value. Do not preserve the original.',
          '',
        ].join('\n')
      : '';

  return [
    // TR_041 Fix 1 — stack compliance check is rendered FIRST so
    // it conditions the LLM before it reads the draft. Empty
    // string (rare — no `HARNESS.stack`) is dropped by the
    // `filter(Boolean)` at the end.
    stackComplianceCheck,
    `You are ${agentCfg.role} performing a design review.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    goldenPrinciplesSection,
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
    // TR_041 Fix 2 — lifecycle coverage. The feature description
    // implies state transitions (e.g. "managers approve or
    // reject" on a leave request); the architecture must include
    // a phase that adds the corresponding mutation method to the
    // owning entity's repository. TR_040 verification surfaced
    // a regression where Phase 1 had only `create + findById`
    // and no later phase ever added `update` — yet Phase 5 was
    // titled "manager approval and rejection workflow".
    '5. Lifecycle coverage — for every entity whose state changes during the feature lifecycle, verify that at least one phase in `recommendedPhases` includes a method to perform that mutation. If a state transition exists in the feature description but no phase adds the corresponding mutation method, ADD it to the most appropriate phase.',
    '',
    'If the draft passes all five checks, return it unchanged.',
    'If any check fails, fix the issue and return the corrected version.',
    'Return the COMPLETE architecture JSON — not just the changes.',
    '',
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

/**
 * TR_042 — Per-phase architecture review prompt. Mirrors
 * `buildArchitectureReviewPrompt` for the FEATURE-level draft, but
 * operates on the per-phase `PhaseArchitecture` shape (interfaces /
 * importStatements / sqlSchema / successCriteria). Same positioning
 * principles as TR_041's `buildArchitectureReviewPrompt`:
 *
 *   1. Stack compliance check rendered FIRST (TR_041 verified that
 *      this is the only prompt position that overrides chat-latest's
 *      framework bias — feature-level cycle came back framework-free
 *      after the move; per-phase still leaked because designPhase
 *      had no review pass).
 *   2. Review checklist with explicit stack + file-list + interface +
 *      import + success-criteria items.
 *   3. Same "REWRITE the relevant field" language — no hedging.
 *
 * STOPGAP (ADR-056): this single-agent self-review is a lightweight
 * stand-in for the LangGraph architecture-crew per-phase reviewer.
 * Delete `buildPhaseArchitectureReviewPrompt` +
 * `ArchitectureAgent.reviewPhaseDesign()` + the orchestrator call
 * site when Phase 1 of the migration lands.
 *
 * The output schema mirrors the original `PhaseArchitecture` shape
 * so the existing `parsePhaseArchitecture` parses the review result.
 * On parse failure the caller returns the original draft unchanged.
 */
export function buildPhaseArchitectureReviewPrompt(
  draft: PhaseArchitecture,
  phase: FeaturePhaseRecord,
  feature: FeatureRecord,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
  goldenPrinciplesMd: string = '',
): string {
  const harnessSection = renderHarnessAgentRules('architecture-agent', harnessConfig);
  const stackSection = renderStackSection(harnessConfig);
  const goldenPrinciplesSection = renderGoldenPrinciplesSection(goldenPrinciplesMd);
  const draftJson = JSON.stringify(draft, null, 2).slice(0, 2000);

  // TR_042 — Stack compliance check rendered FIRST. TR_041 verified
  // that any other prompt position lets chat-latest's framework
  // bias bleed through into the per-phase success criteria.
  const stack = harnessConfig?.stack;
  const stackComplianceCheck =
    stack && Object.keys(stack).length > 0
      ? [
          '## MANDATORY: Stack compliance check (read this first)',
          '',
          'The following stack is declared for this project. It is',
          'the authoritative source for every framework, library,',
          'and tool choice in the per-phase design you are about to',
          'review. You MUST treat any deviation in the draft below',
          'as a defect that you correct before returning. Do not',
          'hedge with "or" alternatives ("Jest or Vitest tests …").',
          '',
          '```json',
          JSON.stringify(stack, null, 2),
          '```',
          '',
          'Before returning:',
          '- Verify every framework reference in the success criteria,',
          '  interface signatures, and import statements matches the',
          '  declared stack.',
          '- If you find any mismatch, REWRITE the relevant field with',
          '  the declared stack value. Do not preserve the original.',
          '',
        ].join('\n')
      : '';

  return [
    stackComplianceCheck,
    `You are ${agentCfg.role} reviewing a per-phase design.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    harnessSection,
    stackSection,
    goldenPrinciplesSection,
    '## Phase being reviewed',
    `Feature: ${feature.title}`,
    `Phase ${phase.phaseIndex + 1}: ${phase.title}`,
    '',
    '## Phase scope (from planner-agent — the authoritative file list lives in the architecture below, not in the planner scope)',
    phase.scope,
    '',
    '## Draft per-phase architecture to review',
    '```json',
    draftJson,
    '```',
    '',
    '## Review checklist',
    'Review the draft for:',
    '1. Stack compliance — no framework references outside the declared stack (no Vitest if the stack says Jest, no Express if the stack says Fastify, etc).',
    '2. File list completeness — every file the phase must create is named under `interfaces` (with `File: <path>\\n<contents>` framing) and referenced by `importStatements` and `successCriteria` consistently.',
    '3. Interface completeness — every interface has exact method signatures, no `// TODO` or `...` ellipses.',
    '4. Import accuracy — every entry in `importStatements` references a file that already exists OR is being created in this phase. No reference to a future phase\'s files.',
    '5. Success-criteria accuracy — every criterion uses the declared stack, names real file paths, and is independently verifiable.',
    '',
    'If the draft passes all five checks, return it unchanged.',
    'If any check fails, fix the issue and return the corrected version.',
    'Return the COMPLETE PhaseArchitecture JSON — not just the changes.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences — in the same schema as the input:',
    '',
    '```json',
    '{',
    '  "interfaces": [',
    '    "File: src/modules/<name>/<name>.model.ts\\nexport interface ...",',
    '    "File: src/modules/<name>/<name>.repository.ts\\nimport { ... } from \\"./...\\";\\nexport interface ..."',
    '  ],',
    '  "importStatements": [',
    '    "import { ... } from \\"./<name>.model\\""',
    '  ],',
    '  "sqlSchema": "CREATE TABLE ... (optional — omit when the phase has no SQL changes)",',
    '  "successCriteria": [',
    '    "src/modules/<name>/<name>.model.ts exists and exports ..."',
    '  ]',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}

/**
 * TR_044 — Prompt that asks an LLM to produce a canonical-name →
 * alternatives map for the declared project stack. The platform
 * code does NOT hardcode framework alternatives; the LLM knows
 * which frameworks compete with which in any ecosystem, so we ask
 * it once per feature.
 *
 * Output schema (the LLM must return ONLY this JSON):
 *
 *   {
 *     "Jest":    ["Vitest", "Mocha", "Jasmine"],
 *     "Fastify": ["Express", "Koa", "Hapi"]
 *   }
 *
 * The keys are the declared canonical names from
 * `HARNESS.json.stack` verbatim; the values are realistic
 * alternatives a developer in the same ecosystem might confuse
 * with the declared choice.
 *
 * No framework knowledge in the platform code — only the prompt
 * structure + the JSON schema framing.
 */
export function buildStackSubstitutionPrompt(stack: Record<string, string>): string {
  return [
    'You are a software framework expert.',
    '',
    'The following technology stack is declared for a project:',
    '',
    '```json',
    JSON.stringify(stack, null, 2),
    '```',
    '',
    'For each declared framework or tool, list the most common',
    'alternative names or frameworks that a developer might',
    'accidentally use instead.',
    '',
    'Return ONLY valid JSON — no preamble, no markdown:',
    '',
    '```json',
    '{',
    '  "<declared-name>": ["<alternative-1>", "<alternative-2>", "..."]',
    '}',
    '```',
    '',
    'Only include entries for values that actually appear in the',
    'declared stack above. Only list realistic alternatives that',
    'a developer in this ecosystem might confuse with the declared',
    'choice. Skip values that are clearly not framework choices',
    '(e.g. version numbers, true/false flags).',
    '',
    'Example for a TypeScript/Jest/Fastify stack:',
    '',
    '```json',
    '{',
    '  "Jest":    ["Vitest", "Mocha", "Jasmine"],',
    '  "Fastify": ["Express", "Koa", "Hapi"]',
    '}',
    '```',
  ].join('\n');
}

/**
 * TR_044 — Pure utility. Apply a `<alternative-lowercase> →
 * <canonical>` substitution map to every string field of a
 * `PhaseArchitecture`. Word-boundary regex matches keep
 * substring collisions (e.g. "express-train" if "express" were
 * in the map) from rewriting unintended tokens.
 *
 * No framework knowledge inside this function — it receives a
 * Map and applies it, byte-for-byte. The caller (built from the
 * LLM-generated substitution map) is responsible for what gets
 * substituted.
 *
 * Returns a new `PhaseArchitecture` — the input is never mutated.
 */
export function applyStackSubstitutions(
  draft: PhaseArchitecture,
  substitutions: Map<string, string>,
): PhaseArchitecture {
  if (substitutions.size === 0) return draft;

  const rewrite = (s: string): string => {
    let out = s;
    for (const [alt, canonical] of substitutions.entries()) {
      // Word-boundary, case-insensitive match. `alt` is stored in
      // lowercase by the caller; the `i` flag matches mixed-case
      // occurrences ("Vitest", "vitest", "VITEST") consistently.
      const re = new RegExp(`\\b${escapeRegex(alt)}\\b`, 'gi');
      out = out.replace(re, canonical);
    }
    return out;
  };

  const result: PhaseArchitecture = {
    interfaces: draft.interfaces.map(rewrite),
    importStatements: draft.importStatements.map(rewrite),
    successCriteria: draft.successCriteria.map(rewrite),
  };
  if (draft.sqlSchema !== undefined) {
    result.sqlSchema = rewrite(draft.sqlSchema);
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
