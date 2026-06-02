/**
 * LLM prompt builder for the code agent.
 *
 * Section order matters — the LLM reads top-to-bottom, so the
 * non-negotiable rules go first:
 *
 *   1. Architecture        — module structure + patterns the project
 *                            already follows
 *   2. Constraint rules    — project-defined CONSTRAINT_VIOLATION rules
 *                            from HARNESS.json. These are checked by
 *                            the constraint-agent after generation;
 *                            violating them fails the cycle
 *   3. Design spec         — design-agent's structured output (API
 *                            contracts, file layout) loaded from
 *                            `.gestalt/design-spec.json` artifact
 *   4. Intent              — what to build, success criteria, scope,
 *                            out-of-scope
 *   5. Golden principles   — non-negotiable platform-level rules
 *   6. Domain model        — entities + relationships from DOMAIN.md
 *   7. Signal feedback     — on a gate-driven retry, the prior
 *                            signals routed to the code-agent
 *                            (shared `buildSignalFeedback`)
 *   8. Task instructions   — JSON-array output format
 *
 * Sections are filter-joined so absent context (no design-spec on
 * the first cycle, no signals on the first attempt) leaves no
 * trailing blank header.
 */

import type { ContextSnapshot, FeedbackSignal } from '../types';
import { applyAgentConfig } from './agent-config-helpers';
import { buildSignalFeedback } from './signal-formatter';

const ARCHITECTURE_TRUNCATE_CHARS = 2000;
const DOMAIN_TRUNCATE_CHARS = 2000;
const DESIGN_TRUNCATE_CHARS = 3000;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[...truncated, ${text.length - limit} more chars]`;
}

export function buildCodePrompt(
  ctx: ContextSnapshot,
  attempt: number,
  priorSignals: FeedbackSignal[] = ctx.priorSignals ?? [],
): string {
  // ── 0. File tools available (ADR-038) ──────────────────────────────
  //
  // Sits ABOVE the architecture section so the model reads the
  // discovery workflow before any of the constraint sections. The
  // section is omitted when the agent's resolved `tools.builtin` is
  // empty (legacy projects without an `agents.yaml`, or agents.yaml
  // entries that explicitly disable tools).
  const toolsBuiltin = ctx.agentConfig.tools?.builtin ?? [];
  const toolsSection = toolsBuiltin.length > 0
    ? `## File tools available\n\n` +
      `You have access to these tools to read the existing codebase ` +
      `before generating output:\n` +
      `- **getFileTree** — understand the project structure first\n` +
      `- **readFile(path)** — read a file before modifying it\n` +
      `- **listDirectory(path)** — explore a directory\n` +
      `- **searchFiles(pattern)** — find where something is defined\n\n` +
      `**Workflow for modification intents:**\n` +
      `1. Call getFileTree to understand the project structure\n` +
      `2. Call readFile on the specific file(s) you need to modify\n` +
      `3. Make SURGICAL changes — only modify what the intent asks for\n` +
      `4. Return ONLY the files you actually changed\n\n` +
      `**Workflow for new file intents:**\n` +
      `1. Call listDirectory on the target module directory\n` +
      `2. Call searchFiles to check if something similar already exists\n` +
      `3. Generate the new file consistent with existing patterns`
    : '';

  // ── 1. Architecture context ────────────────────────────────────────
  const architectureSection = ctx.architectureMd
    ? `## Project architecture\n\n${truncate(ctx.architectureMd, ARCHITECTURE_TRUNCATE_CHARS)}\n\n` +
      `You MUST follow the module structure and patterns described ` +
      `above. Do not create files outside the documented structure ` +
      `without a clear reason.`
    : '';

  // ── 2. Scope enforcement (prevents scope creep) ────────────────────
  //
  // Without this section, the code-agent often generates whole
  // module trees for narrow intents ("fix tsx version in
  // package.json" → 12 files). The intent-agent's
  // `affectedDomains` may already be tight; this section turns
  // those domains into explicit DO/DO-NOT rules so the LLM
  // doesn't bring its own training-data prior about "what a
  // typical project of this shape looks like".
  const affectedDomains =
    ctx.intentSpec.scope.affectedDomains.length > 0
      ? ctx.intentSpec.scope.affectedDomains.join(', ')
      : 'see intent';
  const scopeSection =
    `## Scope — generate ONLY what the intent asks for\n\n` +
    `Affected areas: ${affectedDomains}\n\n` +
    `RULES:\n` +
    `- If the intent fixes a bug or version → change ONLY the affected file\n` +
    `- If the intent adds one function → generate ONLY that file and its test\n` +
    `- If the intent says "scaffold" or "set up" → broader scope is acceptable\n` +
    `- Do NOT generate shared infrastructure unless the intent explicitly asks for it\n` +
    `- Do NOT generate files that are not directly required by the success criteria\n` +
    `- NEVER add @gestalt/* packages as dependencies in package.json. ` +
    `These are internal Gestalt platform packages, not npm packages.\n` +
    `- NEVER import from @gestalt/* in generated application code.`;

  // ── 3. Constraint rules (from HARNESS.json) ────────────────────────
  const constraintRules = ctx.harness?.constraints?.rules ?? [];
  const constraintsSection =
    constraintRules.length > 0
      ? `## Constraint rules — violations will fail the quality gate\n\n` +
        constraintRules
          .map((r) => `- **${r.id}** (${r.severity}): ${r.description}`)
          .join('\n')
      : '';

  // ── 3. Design-agent output ─────────────────────────────────────────
  const designSpec = ctx.priorArtifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/design-spec.json'),
  );
  const designSection = designSpec
    ? `## Design specification\n\n` +
      `The design-agent produced this specification. Implement it ` +
      `faithfully:\n\n` +
      '```json\n' +
      truncate(designSpec.content, DESIGN_TRUNCATE_CHARS) +
      '\n```'
    : '';

  // ── 4. Intent spec ─────────────────────────────────────────────────
  const successList = ctx.intentSpec.successCriteria
    .map((c) => `- ${c}`)
    .join('\n');
  const scopeList = ctx.intentSpec.scope.affectedDomains
    .map((d) => `- ${d}`)
    .join('\n');
  const intentSection =
    `## Intent specification\n\n` +
    `**What to build:** ${ctx.intentSpec.rawIntent}\n\n` +
    (successList ? `**Success criteria:**\n${successList}\n\n` : '') +
    (scopeList ? `**Scope (affected areas):**\n${scopeList}\n\n` : '') +
    `**Out of scope:** ${
      ctx.intentSpec.outOfScope.length > 0
        ? ctx.intentSpec.outOfScope.join(', ')
        : 'nothing explicitly excluded'
    }`;

  // ── 5. Golden principles ───────────────────────────────────────────
  const principlesSection =
    ctx.goldenPrinciples.length > 0
      ? `## Golden principles — non-negotiable\n\n` +
        ctx.goldenPrinciples
          .map((p) => `- **${p.id} — ${p.title}:** ${p.description}`)
          .join('\n')
      : '';

  // ── 6. Domain context ──────────────────────────────────────────────
  const domainSection = ctx.domainMd
    ? `## Domain model\n\n${truncate(ctx.domainMd, DOMAIN_TRUNCATE_CHARS)}`
    : '';

  // ── 7. Signal feedback (retry cycles only) ─────────────────────────
  const signalsSection = buildSignalFeedback(priorSignals);

  // ── 8. Task instructions ───────────────────────────────────────────
  const retryHint =
    attempt > 0
      ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only — no commentary, no markdown fences.`
      : '';
  const taskSection =
    `## Generate code now\n\n` +
    `Generate the TypeScript code files needed to implement the intent above. ` +
    `Follow the architecture, respect all constraints, implement the design ` +
    `spec faithfully, and stay within the Scope section's rules — include ` +
    `ONLY files within the scope defined above.${retryHint}\n\n` +
    `Return a JSON object with this structure:\n\n` +
    '```json\n' +
    `{\n  "files": [\n    { "path": "src/...", "content": "..." }\n  ]\n}\n` +
    '```\n\n' +
    `File organisation rules:\n` +
    `- src/modules/<domain>/domain/<entity>.ts — entity types and interfaces\n` +
    `- src/modules/<domain>/repository/<entity>-repository.ts — data access\n` +
    `- src/modules/<domain>/service/<service>.ts — business logic\n` +
    `- src/modules/<domain>/routes/<resource>-routes.ts — API handlers\n` +
    `- src/modules/<domain>/index.ts — public exports only\n\n` +
    `Code rules:\n` +
    `- TypeScript strict mode — no 'any', explicit return types on all exports\n` +
    `- Named exports only — no default exports except React components\n` +
    `- All repository methods parameterised — no string concatenation in SQL\n` +
    `- Every exported function has a JSDoc comment\n` +
    `- Error handling: return typed Result<T,E> or throw with structured context`;

  const body = [
    toolsSection,          // ← NEW (ADR-038) — top of prompt when tools configured
    architectureSection,
    scopeSection,
    constraintsSection,
    designSection,
    intentSection,
    principlesSection,
    domainSection,
    signalsSection,
    taskSection,
  ]
    .filter(Boolean)
    .join('\n\n');

  return applyAgentConfig(body, ctx.agentConfig);
}
