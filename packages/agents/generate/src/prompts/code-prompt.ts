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
import { renderHarnessAgentRules, renderScriptToolInstruction } from '@gestalt/core';

const ARCHITECTURE_TRUNCATE_CHARS = 2000;
const DOMAIN_TRUNCATE_CHARS = 2000;
const DESIGN_TRUNCATE_CHARS = 3000;
const AGENTS_MD_TRUNCATE_CHARS = 3000;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[...truncated, ${text.length - limit} more chars]`;
}

/**
 * Pretty-prints the `harness.stack.runtime` string for the
 * code-prompt's architecture section. Recognised shapes:
 *   - "node22" / "node20" / "node18"  → "Node 22 LTS" etc.
 *   - "node"                          → "Node 22 LTS" (default)
 *   - anything else                   → returned verbatim
 * Future runtime kinds (deno, bun) pass through unchanged, so a
 * project declaring them in HARNESS.json gets the truth.
 */
function formatRuntime(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const nodeMatch = /^node\s*(\d+)?$/.exec(lower);
  if (nodeMatch) {
    const major = nodeMatch[1] ?? '22';
    // Even majors are LTS lines on Node's release schedule.
    const isLts = Number.parseInt(major, 10) % 2 === 0;
    return isLts ? `Node ${major} LTS` : `Node ${major}`;
  }
  return raw;
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
  //
  // Runtime + language note: user projects target Node 22 LTS by
  // default — the Gestalt PLATFORM runs on Node 20 + pnpm 9.x as a
  // self-imposed constraint, but that has no bearing on generated
  // user code. The dynamic-harness session (2026-06-04) also
  // surfaces `language` + `packageManager` so non-Node projects
  // (Python, Go, etc.) get a meaningful note.
  //
  // Priority order for picking what the LLM sees:
  //   1. `harness.stack.nodeVersion` — explicit Node version from
  //      the dynamic-harness HARNESS.json (new template shape)
  //   2. `harness.stack.runtime` — legacy field for back-compat
  //      with projects initialised before the dynamic-harness
  //      session (the old template wrote `runtime: "node22"`)
  //   3. `harness.stack.language` non-TypeScript → render that
  //      language directly (e.g. "Project language: Python, pip
  //      as package manager.")
  //   4. otherwise, fall back to "Node 22 LTS" ONLY when the
  //      architectureMd doesn't already mention a Node version
  //      (avoids contradicting a legacy project's documented
  //      runtime, e.g. an old project still pinning Node 20)
  const stack = ctx.harness?.stack ?? {};
  const harnessNodeVersion = stack['nodeVersion'];
  const harnessRuntime = stack['runtime'];
  const harnessLanguage = stack['language'];
  const harnessPackageManager = stack['packageManager'] ?? 'pnpm';
  const archMentionsNode =
    ctx.architectureMd
      ? /node\s*\d|Node\s*\d|node\.js|Node\.js/i.test(ctx.architectureMd)
      : false;
  const isNonNodeLanguage =
    harnessLanguage !== undefined &&
    harnessLanguage !== '' &&
    harnessLanguage.toLowerCase() !== 'typescript' &&
    harnessLanguage.toLowerCase() !== 'javascript';
  const runtimeNote =
    harnessNodeVersion && harnessNodeVersion !== 'N/A' && harnessNodeVersion !== 'null'
      ? `\n\nProject runtime: ${formatRuntime(`node${harnessNodeVersion}`)}, ${harnessPackageManager} as package manager.`
      : harnessRuntime
        ? `\n\nProject runtime: ${formatRuntime(harnessRuntime)}, ${harnessPackageManager} as package manager.`
        : isNonNodeLanguage
          ? `\n\nProject language: ${harnessLanguage}, ${harnessPackageManager} as package manager.`
          : !archMentionsNode
            ? `\n\nDefault runtime: Node 22 LTS, pnpm as package manager.`
            : '';

  const architectureSection = ctx.architectureMd
    ? `## Project architecture\n\n${truncate(ctx.architectureMd, ARCHITECTURE_TRUNCATE_CHARS)}${runtimeNote}\n\n` +
      `You MUST follow the module structure and patterns described ` +
      `above. Do not create files outside the documented structure ` +
      `without a clear reason.`
    : runtimeNote
      ? `## Project architecture${runtimeNote}`
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

  // ── 6b. Project coding conventions (TEST_REPORT_002 Fix 7) ─────────
  //
  // Render AGENTS.md verbatim so the code-agent picks up the
  // project's documented conventions (named-vs-default exports,
  // module layout, "must never" lists, dependency rules) without an
  // explicit readFile tool call. Truncated for prompt-budget safety;
  // the most important rules in a Gestalt AGENTS.md sit at the top
  // (in the architecture-rules + coding-conventions sections).
  const agentsConventionsSection = ctx.agentsMd
    ? `## Project coding conventions (from AGENTS.md)\n\n${truncate(ctx.agentsMd, AGENTS_MD_TRUNCATE_CHARS)}\n\n` +
      `**You MUST follow these conventions verbatim.** They override any ` +
      `defaults you would otherwise apply (e.g. default-vs-named exports, ` +
      `error-handling pattern, lint rules).`
    : '';

  // ── 6c. Dependency typing rule (TEST_REPORT_002 Fix 4) ─────────────
  //
  // Generated `package.json` files routinely shipped runtime deps
  // without their `@types/*` counterparts (concrete miss in the
  // 2026-06-04 scaffold cycle: `pg` without `@types/pg`). Strict
  // TypeScript compilation then errors out at first import. Pin the
  // rule here so the LLM emits the types alongside every typed
  // runtime dep.
  const depsTypingSection =
    `## Dependency typing rule\n\n` +
    `When you generate \`package.json\`, for every runtime dependency ` +
    `that has a well-known \`@types/*\` package on npm, add the ` +
    `corresponding \`@types/*\` to \`devDependencies\`.\n\n` +
    `Common pairs (NOT exhaustive — apply the rule to ANY typed dep):\n` +
    `- \`express\` → \`@types/express\`\n` +
    `- \`pg\` → \`@types/pg\`\n` +
    `- \`jsonwebtoken\` → \`@types/jsonwebtoken\`\n` +
    `- \`bcrypt\` → \`@types/bcrypt\`\n` +
    `- \`cors\` → \`@types/cors\`\n` +
    `- \`morgan\` → \`@types/morgan\`\n` +
    `- \`supertest\` → \`@types/supertest\`\n` +
    `- Node itself → \`@types/node\`\n\n` +
    `Packages that ship their OWN type definitions (TypeScript-native ` +
    `like \`dotenv\`, \`zod\`, \`pino\`, \`fastify\`, \`prisma\`) do NOT ` +
    `need a separate \`@types/*\` entry.\n\n` +
    `**TypeScript strict mode requires type definitions.** Omitting a ` +
    `\`@types/*\` for a typed dependency will trip \`no-any\` on the ` +
    `consuming import and fail the quality gate.`;

  // ── 6d. TypeScript import hygiene (TEST_REPORT_004 Fix 1) ──────────
  //
  // When a file imports from a database driver package (pg, postgres,
  // mysql, …) ONLY to reference a type in a signature, use the
  // `import type` form. The constraint-agent's
  // `no-direct-db-outside-shared-db` rule treats `import type` as
  // safe (it's erased at compile time and cannot reach the runtime
  // database). The runtime client instance must still come from
  // `src/shared/db/connection.ts`.
  //
  // Concretely: in `src/modules/<x>/<x>.repository.ts` write:
  //   import type { Pool } from 'pg';
  //   import pool from '../../shared/db/connection';
  // NOT:
  //   import { Pool } from 'pg';
  //   import pool from '../../shared/db/connection';
  // The second form trips the rule even though the runtime behaviour
  // is identical.
  const typeImportSection =
    `## TypeScript import hygiene (avoid quality-gate false positives)\n\n` +
    `When importing from a database driver package (\`pg\`, ` +
    `\`postgres\`, \`mysql\`, \`mysql2\`, \`mssql\`, \`oracledb\`) ` +
    `**only for use as a TypeScript type** (e.g. \`Pool\` in a ` +
    `constructor signature, \`PoolClient\` in a method parameter), ` +
    `use the type-only import form:\n\n` +
    '```ts\n' +
    `import type { Pool } from 'pg';\n` +
    '```\n\n' +
    `The runtime client instance must still come from the project's ` +
    `\`src/shared/db/connection.ts\` singleton:\n\n` +
    '```ts\n' +
    `import type { Pool } from 'pg';\n` +
    `import pool from '../../shared/db/connection';\n\n` +
    `export class PostgresLeaveRepository {\n` +
    `  constructor(private readonly pool: Pool = pool) {}\n` +
    `  // ...\n` +
    `}\n` +
    '```\n\n' +
    `The constraint-agent's \`no-direct-db-outside-shared-db\` rule ` +
    `treats \`import type\` as safe (TypeScript erases it at compile ` +
    `time — it cannot reach the runtime database). Writing \`import ` +
    `{ Pool } from 'pg'\` (without \`type\`) in a file outside ` +
    `\`shared/db/\` will trip the rule even if you never instantiate ` +
    `a new Pool there.`;

  // ── 7. Signal feedback (retry cycles only) ─────────────────────────
  const signalsSection = buildSignalFeedback(priorSignals);

  // ── 7b. Resume context (migration 020) ─────────────────────────────
  // Surfaced when the cycle is a self-healing auto-retry OR an
  // operator-feedback resume. The autoHealed branch carries the
  // diagnostician's diagnosis + root cause; the operator branch
  // carries the operator's free-text fix description verbatim.
  const resumeContext = ctx.resumeContext;
  const resumeSection = resumeContext
    ? buildResumeSection(resumeContext, ctx.focusFiles)
    : '';

  // ── 8. Task instructions ───────────────────────────────────────────
  const retryHint =
    attempt > 0
      ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only — no commentary, no markdown fences.`
      : '';
  // TEST_REPORT_010 Fix 2 — explicit exploration-budget guidance.
  // TEST_REPORT_009 disproved live invocation of executeScript on a
  // near-empty scaffold: the LLM spent its entire MAX_TOOL_CALLS
  // budget calling `listDirectory` on directories it was about to
  // CREATE (src/modules/leave/repository, etc.) before reaching the
  // verification step. This block tells the LLM what to read and —
  // more importantly — what NOT to explore.
  //
  // Order matters: this is the FIRST thing in the task section so the
  // LLM reads "don't waste calls on output paths" before any of the
  // file-organisation / code-rules / verification / schema sections.
  const preGenerationSection =
    `## Before generating code\n\n` +
    `1. **Read existing files your generated code will import from.** ` +
    `Use \`readFile\` on each — they're listed in the IntentSpec and ` +
    `the design-spec above (typical examples: \`src/shared/types/index.ts\`, ` +
    `\`src/shared/db/connection.ts\`, \`src/index.ts\`).\n` +
    `2. **Do NOT explore directories that don't exist yet.** You are ` +
    `about to CREATE them. Call \`getFileTree\` ONCE to understand the ` +
    `current shape of the project, then proceed directly to generation. ` +
    `Repeated \`listDirectory\` calls on missing paths burn your budget.\n` +
    `3. **Do NOT call \`listDirectory\` on the OUTPUT paths** listed in ` +
    `the design spec / file-organisation rules below — those paths are ` +
    `the destinations for the files you are about to emit; they will ` +
    `not exist yet.\n` +
    `4. **After emitting, verify with \`executeScript\`** (see the ` +
    `mandatory pre-emit verification section at the end).\n\n` +
    `Budget guidance: ~1 \`getFileTree\` + ~3 \`readFile\` on existing ` +
    `deps + ~2 \`executeScript\` (verify + re-verify) = ~6 purposeful ` +
    `tool calls. Anything more is exploration overhead.\n`;

  // TEST_REPORT_008 Fix 1 — restructured. The JSON-return instruction
  // is now LAST in the prompt; the new `## Mandatory pre-emit
  // verification` block sits immediately above it. Code rules + file
  // organisation rules move up so the LLM reads them first, then
  // commits to the verification step, then commits to the JSON
  // schema. Putting verification + schema together at the end
  // converts "you have a tool" (TEST_REPORT_007 advisory tone) into
  // "you MUST call it before emitting" (mandatory).
  const taskSection =
    preGenerationSection + `\n` +
    `## Generate code now\n\n` +
    `Generate the TypeScript code files needed to implement the intent above. ` +
    `Follow the architecture, respect all constraints, implement the design ` +
    `spec faithfully, and stay within the Scope section's rules — include ` +
    `ONLY files within the scope defined above.${retryHint}\n\n` +
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
    `- Error handling: return typed Result<T,E> or throw with structured context\n\n` +
    `## Mandatory pre-emit verification\n\n` +
    `Before returning the final files JSON you MUST:\n\n` +
    `1. Call \`executeScript\` with the appropriate compile/lint command ` +
    `for this project's stack. Use your knowledge of the stack to pick:\n` +
    `   - TypeScript / Node: \`tsc --noEmit\` (or \`npx tsc --noEmit\`)\n` +
    `   - Python: \`python -m mypy src\` or \`python -m py_compile <files>\`\n` +
    `   - Go: \`go build ./...\`\n` +
    `   - Rust: \`cargo check\`\n` +
    `   - Java: \`mvn compile\` or the project's gradle equivalent\n` +
    `   You can also run \`npm run lint\` / \`npm run typecheck\` / project-specific scripts.\n\n` +
    `2. If the command reports errors: **fix the errors in your ` +
    `generated files and call \`executeScript\` again.** Iterate until ` +
    `the command exits with code 0 OR you've made two attempts.\n\n` +
    `3. Only return the files JSON when the verification command ` +
    `exits with code 0. **If you cannot get it to exit 0 after two ` +
    `attempts, return the best version you have AND include a ` +
    `\`verificationNote\` field** in your JSON describing what failed ` +
    `and what you tried. The downstream gate will see the note and ` +
    `route appropriately.\n\n` +
    `This is not optional. A finding from the gate that "you didn't ` +
    `compile-check before emitting" is a strict failure mode the ` +
    `platform now enforces.\n\n` +
    `## Return format\n\n` +
    `Return ONLY valid JSON — no preamble, no markdown fences:\n\n` +
    '```json\n' +
    `{\n` +
    `  "files": [\n` +
    `    { "path": "src/...", "content": "..." }\n` +
    `  ],\n` +
    `  "verificationNote": "optional — only include if verification did not pass. Describe what failed."\n` +
    `}\n` +
    '```';

  // TEST_REPORT_007 Fix 2 — render `agentConfig['code-agent'].rules`
  // from HARNESS.json + the `executeScript` direction. Placed
  // right after the architecture section so the LLM reads "these
  // are the rules; here's a tool to verify them" before any of
  // the more specific scope / constraint / intent sections. The
  // tool is already in the code-agent's `tools.builtin` per
  // PER_ROLE_DEFAULTS — until this prompt section, the LLM didn't
  // know to reach for it (TEST_REPORT_006 §code-agent).
  //
  // `ctx.harness` is the parsed HarnessConfig the orchestrator
  // already attaches to the snapshot via `assembleContext`.
  const harnessAgentRulesSection = renderHarnessAgentRules('code-agent', ctx.harness);
  const scriptToolSection = renderScriptToolInstruction();

  const body = [
    toolsSection,                  // ← NEW (ADR-038) — top of prompt when tools configured
    architectureSection,
    harnessAgentRulesSection,      // ← NEW (TEST_REPORT_007 Fix 2) — HARNESS.json code-agent.rules
    scriptToolSection,             // ← NEW (TEST_REPORT_007 Fix 2) — executeScript direction
    scopeSection,
    constraintsSection,
    designSection,
    intentSection,
    principlesSection,
    domainSection,
    agentsConventionsSection,      // ← NEW (TEST_REPORT_002 Fix 7) — AGENTS.md
    depsTypingSection,             // ← NEW (TEST_REPORT_002 Fix 4) — @types/* coverage
    typeImportSection,             // ← NEW (TEST_REPORT_004 Fix 1) — `import type` for db drivers
    signalsSection,
    resumeSection,                 // ← NEW (migration 020) — self-healing / operator-feedback resume
    taskSection,
  ]
    .filter(Boolean)
    .join('\n\n');

  return applyAgentConfig(body, ctx.agentConfig);
}

/**
 * Resume-section formatter (migration 020). Two layouts depending
 * on `autoHealed`:
 *   - true  → diagnostician's diagnosis + root cause + suggested fix
 *   - false → operator's feedback verbatim
 * Optional focus files list (carried as `ctx.focusFiles` for ergonomic
 * access) appears at the bottom.
 */
function buildResumeSection(
  resume: NonNullable<CodeContextSnapshotLike['resumeContext']>,
  focusFiles?: string[],
): string {
  const header = `## Resumed attempt (${resume.attemptNumber}) — ${
    resume.autoHealed ? 'auto-diagnosed' : 'operator feedback'
  }`;
  const failure = `Failure: ${resume.failureSummary}`;
  const body = resume.autoHealed
    ? [
        `Diagnosis: ${resume.diagnosis ?? '(none recorded)'}`,
        `Root cause: ${resume.rootCause ?? '(none recorded)'}`,
        `Suggested fix: ${resume.operatorFeedback}`,
      ].join('\n')
    : `Operator feedback: ${resume.operatorFeedback}`;
  const focus = focusFiles && focusFiles.length > 0
    ? `\n\nFocus on these files (identified as root cause):\n${focusFiles.map((f) => `  - ${f}`).join('\n')}`
    : '';
  return `${header}\n\n${failure}\n\n${body}${focus}`;
}

/** Structural projection used by the formatter — local to this module. */
type CodeContextSnapshotLike = {
  resumeContext?: {
    operatorFeedback: string;
    failureSummary: string;
    attemptNumber: number;
    autoHealed: boolean;
    diagnosis?: string;
    rootCause?: string;
  } | null;
};
