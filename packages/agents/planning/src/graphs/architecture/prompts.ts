/**
 * Architecture-crew prompts (TR_051 / ADR-056 Phase 1).
 *
 * Strict ADR-042 compliance: structural framing + JSON output
 * schemas only. All guidance text lives in:
 *   - `agents.yaml` → `agentConfig.<role>.prompt_extensions[]`
 *   - `HARNESS.json` → `agentConfig.<role>.rules[]` / `.architectureGuidance[]`
 *
 * The crew reuses the same context blocks the single architecture-
 * agent saw — project stack, GOLDEN_PRINCIPLES.md, existing
 * ARCHITECTURE.md excerpt — so the migration is structural, not a
 * context-loss step.
 */

import type { AgentConfig, FeatureRecord, HarnessConfig } from '@gestalt/core';
import { renderHarnessAgentRules } from '@gestalt/core';
import type { DomainDesign, DataDesign, AppDesign } from './types';

// ─── Shared section renderers ────────────────────────────────────────

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

function renderGoldenPrinciplesSection(goldenPrinciplesMd: string): string {
  const trimmed = goldenPrinciplesMd.trim();
  if (trimmed.length === 0) return '';
  return [
    '## Project golden principles (cross-cutting concerns)',
    '',
    'These project-wide rules govern every feature. Account for them',
    'in your design — every entity, interface, schema, phase, and',
    'success criterion you emit must satisfy these principles or',
    'include a phase that fulfils them.',
    '',
    trimmed.slice(0, 3000),
    '',
  ].join('\n');
}

function renderExtensions(agentCfg: AgentConfig): string {
  const ext = agentCfg.promptExtensions ?? [];
  if (ext.length === 0) return '';
  return [
    '## Project-specific instructions',
    ...ext.map((e) => `- ${e}`),
    '',
  ].join('\n');
}

function renderArchExcerpt(existingArchitectureMd: string): string {
  const excerpt = existingArchitectureMd.slice(0, 3000);
  return [
    '## Existing project architecture (docs/ARCHITECTURE.md, truncated to 3000 chars)',
    excerpt || '(no existing architecture file)',
    '',
  ].join('\n');
}

function renderFeatureBlock(feature: FeatureRecord): string {
  return [
    '## Feature to design',
    `Title: ${feature.title}`,
    '',
    'Description:',
    feature.description,
    '',
  ].join('\n');
}

// ─── Domain architect ────────────────────────────────────────────────

export function buildDomainArchitectPrompt(
  feature: FeatureRecord,
  existingArchitectureMd: string,
  goldenPrinciplesMd: string,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    renderHarnessAgentRules('domain-architect-agent', harnessConfig),
    renderStackSection(harnessConfig),
    renderGoldenPrinciplesSection(goldenPrinciplesMd),
    renderArchExcerpt(existingArchitectureMd),
    renderFeatureBlock(feature),
    renderExtensions(agentCfg),
    '## Task',
    'Define the DOMAIN slice of the architecture for this feature.',
    'Do not specify persistence, modules, or APIs — those belong to the',
    'data architect and the application architect. Focus on entities,',
    'their attributes, lifecycle states, and the business rules that',
    'cross entity boundaries.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "domainEntities": [',
    '    {',
    '      "name": "...",',
    '      "attributes": ["..."],',
    '      "purpose": "...",',
    '      "lifecycleStates": ["..."]',
    '    }',
    '  ],',
    '  "businessRules": ["..."],',
    '  "domainNotes": "markdown describing the domain"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}

// ─── Data architect ──────────────────────────────────────────────────

export function buildDataArchitectPrompt(
  feature: FeatureRecord,
  existingArchitectureMd: string,
  goldenPrinciplesMd: string,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    renderHarnessAgentRules('data-architect-agent', harnessConfig),
    renderStackSection(harnessConfig),
    renderGoldenPrinciplesSection(goldenPrinciplesMd),
    renderArchExcerpt(existingArchitectureMd),
    renderFeatureBlock(feature),
    renderExtensions(agentCfg),
    '## Task',
    'Define the PERSISTENCE slice of the architecture for this feature.',
    'Do not specify domain entities (the domain architect handles that)',
    'nor service interfaces (the application architect handles that).',
    'Focus on SQL schema, repository interfaces with their concrete',
    'backing implementations, and any persistence-side cross-cutting',
    'concerns (indices, constraints, audit tables).',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "sqlSchemas": ["CREATE TABLE ... ;"],',
    '  "repositories": [',
    '    {',
    '      "interfaceName": "...",',
    '      "concreteName": "...",',
    '      "methods": ["..."],',
    '      "backing": "concrete implementation (e.g. pg Pool)"',
    '    }',
    '  ],',
    '  "dataNotes": "markdown describing persistence concerns"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}

// ─── Application architect ───────────────────────────────────────────

export function buildAppArchitectPrompt(
  feature: FeatureRecord,
  existingArchitectureMd: string,
  goldenPrinciplesMd: string,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
): string {
  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    renderHarnessAgentRules('app-architect-agent', harnessConfig),
    renderStackSection(harnessConfig),
    renderGoldenPrinciplesSection(goldenPrinciplesMd),
    renderArchExcerpt(existingArchitectureMd),
    renderFeatureBlock(feature),
    renderExtensions(agentCfg),
    '## Task',
    'Define the APPLICATION slice of the architecture for this feature.',
    'Do not specify domain entities (domain architect) or SQL schema',
    '(data architect). Focus on module boundaries, service interfaces',
    'with method signatures, dependency direction, and the phased',
    'decomposition order. Verify no circular dependencies between the',
    'modules you propose.',
    '',
    'Return ONLY a single JSON object — no preamble, no markdown fences:',
    '',
    '```json',
    '{',
    '  "modules": [',
    '    { "name": "...", "path": "src/modules/...", "owns": ["..."] }',
    '  ],',
    '  "services": [',
    '    { "name": "...", "path": "...", "methods": ["..."] }',
    '  ],',
    '  "dependencyMap": [',
    '    { "from": "...", "to": "..." }',
    '  ],',
    '  "recommendedPhases": [',
    '    { "title": "...", "rationale": "...", "estimatedFiles": 3 }',
    '  ],',
    '  "appNotes": "markdown describing the application layer"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}

// ─── Chief architect (supervisor) ────────────────────────────────────

/**
 * The chief receives the three specialist designs and reconciles
 * them into the final `FeatureArchitecture`. It is a reconciler —
 * not a regenerator — and its role is captured by the rules in
 * `HARNESS.json.agentConfig['chief-architect-agent']`.
 *
 * Returns `FeatureArchitecture` directly (the same shape the
 * planning orchestrator already persists in `features.architecture`),
 * so the migration is a structural drop-in: the orchestrator
 * doesn't need to learn a new shape.
 */
export function buildChiefArchitectPrompt(
  feature: FeatureRecord,
  domainDesign: DomainDesign | null,
  dataDesign: DataDesign | null,
  appDesign: AppDesign | null,
  existingArchitectureMd: string,
  goldenPrinciplesMd: string,
  agentCfg: AgentConfig,
  harnessConfig: HarnessConfig | null,
  specialistErrors: string[],
): string {
  const errorsSection = specialistErrors.length > 0
    ? [
      '## Specialist errors',
      'One or more specialist designs failed to produce output. Treat',
      'the corresponding slice as MISSING and reconcile around it.',
      ...specialistErrors.map((e) => `- ${e}`),
      '',
    ].join('\n')
    : '';

  return [
    `You are ${agentCfg.role} working on a cloned project at the current working directory.`,
    `Goal: ${agentCfg.goal}.`,
    '',
    renderHarnessAgentRules('chief-architect-agent', harnessConfig),
    renderStackSection(harnessConfig),
    renderGoldenPrinciplesSection(goldenPrinciplesMd),
    renderArchExcerpt(existingArchitectureMd),
    renderFeatureBlock(feature),
    errorsSection,
    '## Domain architect output',
    '```json',
    JSON.stringify(domainDesign ?? {}, null, 2),
    '```',
    '',
    '## Data architect output',
    '```json',
    JSON.stringify(dataDesign ?? {}, null, 2),
    '```',
    '',
    '## Application architect output',
    '```json',
    JSON.stringify(appDesign ?? {}, null, 2),
    '```',
    '',
    renderExtensions(agentCfg),
    '## Task',
    'Reconcile the three specialist designs into a single coherent',
    "FeatureArchitecture. Your role is reconciliation — do not",
    'regenerate work the specialists already did. Resolve naming',
    'conflicts by choosing one canonical symbol and applying it',
    'consistently across entities, repositories, services, and the',
    'markdown summary. Verify stack compliance across all three',
    'slices before producing the final output. If a specialist',
    'slice is missing or empty, supply the smallest reconciliation',
    'that keeps the feature buildable.',
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
    '  "sqlSchemas": ["CREATE TABLE ... ;"],',
    '  "architectureMdUpdate": "markdown to append to docs/ARCHITECTURE.md"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}
