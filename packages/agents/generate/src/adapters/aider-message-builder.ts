/**
 * Build the Aider message from the cycle's context snapshot (TR_014).
 *
 * The Aider message is intentionally MINIMAL: the task, the success
 * criteria, the project rules, and — TR_034 — the SCOPED PER-PHASE
 * architecture (exact file paths + exports + import statements).
 *
 * Pre-TR_034 the message used two heavyweight context blocks:
 *   - `## Project architecture` (full `docs/ARCHITECTURE.md`)
 *   - `## Design context`       (full `design-spec.json` from design-agent)
 *
 * Both described modules by NAME (e.g. "Use the `shared/db` module"),
 * not by file path. TR_033 verification confirmed Aider on gpt-5.5
 * hallucinated import paths like `../../shared/db` straight from the
 * architecture's module-name references. TR_034 replaces both blocks
 * with the architecture-agent's per-phase `PhaseArchitecture` rendered
 * as exact file paths + exports + import statements — produced by
 * `designPhase()` when `HARNESS.json planner.architectureReviewPerPhase
 * === true` and persisted onto `feature_phases.architecture`.
 *
 * The caller (`aider-code-agent.ts`) looks up the phase row via
 * `findPhaseByIntent` and renders the JSON through
 * `renderPhaseArchitecture` before calling this builder.
 *
 * This is the opposite contract from the Gestalt-native code-agent
 * (fully spec'd JSON-output prompt). Aider operates on prose tasks
 * and writes files via its own tool loop.
 */

import type { ContextSnapshot, IntentSpec } from '../types';

const MAX_PHASE_ARCH_BYTES = 4000;

/**
 * TR_032 — matches any token that looks like a relative project
 * path with a known source / config extension. Used to pull cited
 * files out of the intent's raw text (the planner emits them
 * verbatim per the TR_029 phaseScopingRules) so they can be
 * forwarded to Aider as `--read` flags.
 *
 * Extensions are deliberately broad — we catch TypeScript /
 * JavaScript / JSON / YAML / Markdown / Python / SQL. The `existsSync`
 * filter in `runAider` drops any path that isn't actually present
 * in the work-dir, so over-extraction is harmless.
 */
const FILE_PATH_RE =
  /(?<![\w/])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|py|sql))(?![\w/])/g;

/**
 * Result of building an Aider message — TR_032 split the previous
 * single-string return into the message body plus the file list to
 * pass to `runAider` via `--read`.
 */
export interface AiderMessage {
  message: string;
  /**
   * Paths (relative to the project root) the caller should pass to
   * `runAider`'s `readFiles` parameter. PLAN.md + cross-language
   * compiler/dependency manifests are always present (TR_033). The
   * `runAider` adapter is responsible for filtering against
   * `existsSync` before invoking Aider — over-inclusion here is
   * intentional.
   */
  readFiles: string[];
}

export function buildAiderMessage(
  intentSpec: IntentSpec,
  /**
   * TR_034 — the per-phase scoped architecture (rendered as markdown)
   * produced by `architecture-agent.designPhase()` and rendered by
   * `renderPhaseArchitecture()` in the caller. `null` when
   * `architectureReviewPerPhase` is off or the design step failed —
   * the message then drops to task + rules only, which is better
   * than the pre-TR_034 full-architecture block that drove the
   * module-name hallucinations.
   */
  phaseArchitecture: string | null,
  snapshot: ContextSnapshot,
): AiderMessage {
  const codeAgentRules =
    snapshot.harness.agentConfig?.['code-agent']?.rules ?? [];

  // TR_032 + TR_033 — base readFiles list spans cross-language
  // compiler/dependency manifests; existsSync naturally drops files
  // a project doesn't use.
  const scopePaths = extractMentionedPaths(intentSpec.rawIntent ?? '');
  const readFiles = dedupe([
    'PLAN.md',
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'pom.xml',
    'mypy.ini',
    '.eslintrc',
    '.eslintrc.json',
    ...scopePaths,
  ]);

  const sections: string[] = ['## Task', intentSpec.rawIntent];

  if (intentSpec.successCriteria && intentSpec.successCriteria.length > 0) {
    sections.push('');
    sections.push('## Success criteria');
    sections.push(
      intentSpec.successCriteria.map((c) => `- ${c.description}`).join('\n'),
    );
  }

  if (intentSpec.outOfScope && intentSpec.outOfScope.length > 0) {
    sections.push('');
    sections.push('## Out of scope (do NOT touch these)');
    sections.push(intentSpec.outOfScope.map((s) => `- ${s}`).join('\n'));
  }

  if (codeAgentRules.length > 0) {
    sections.push('');
    sections.push('## Project rules');
    sections.push(codeAgentRules.map((r) => `- ${r}`).join('\n'));
  }

  if (phaseArchitecture && phaseArchitecture.trim().length > 0) {
    sections.push('');
    sections.push('## Scoped architecture for this phase');
    sections.push(
      'The following describes ONLY what exists now and what you\n' +
        'are building in this phase. Use these exact file paths,\n' +
        'exact export names, and exact import statements. Do not\n' +
        'invent paths or imports — if it is not listed here, it\n' +
        'does not exist.',
    );
    sections.push('');
    sections.push(phaseArchitecture.slice(0, MAX_PHASE_ARCH_BYTES));
  }

  return {
    message: sections.join('\n').trim(),
    readFiles,
  };
}

/**
 * TR_034 — render the architecture-agent's `PhaseArchitecture`
 * JSON into a markdown block Aider can read. Free function so the
 * caller stays decoupled from the planning package's types — the
 * shape is structural.
 *
 * Returns an empty string when the input is null / empty so the
 * caller can pass the result straight into `buildAiderMessage`'s
 * `phaseArchitecture` parameter.
 */
export function renderPhaseArchitecture(
  pa: PhaseArchitectureShape | null,
): string {
  if (!pa) return '';
  const parts: string[] = [];

  if (pa.importStatements && pa.importStatements.length > 0) {
    parts.push('### Existing dependencies — use these exact imports');
    parts.push('');
    for (const stmt of pa.importStatements) {
      parts.push(stmt);
    }
    parts.push('');
  }

  if (pa.interfaces && pa.interfaces.length > 0) {
    parts.push('### Interfaces / types this phase implements');
    parts.push('');
    for (const iface of pa.interfaces) {
      parts.push(iface);
      parts.push('');
    }
  }

  if (pa.sqlSchema && pa.sqlSchema.trim().length > 0) {
    parts.push('### SQL schema this phase introduces');
    parts.push('');
    parts.push(pa.sqlSchema);
    parts.push('');
  }

  if (pa.successCriteria && pa.successCriteria.length > 0) {
    parts.push('### Success criteria for this phase');
    parts.push('');
    for (const sc of pa.successCriteria) {
      parts.push(`- ${sc}`);
    }
  }

  return parts.join('\n').trim();
}

/**
 * Structural shape of `PhaseArchitecture` — duplicated locally so
 * `@gestalt/agents-generate` does not import from `@gestalt/agents-planning`
 * (the architecture rule forbids agents from importing each other).
 * Keep in sync with `packages/agents/planning/src/types.ts`.
 */
export interface PhaseArchitectureShape {
  interfaces: string[];
  importStatements: string[];
  sqlSchema?: string;
  successCriteria: string[];
}

/**
 * TR_032 — extract file paths from prose. The planner emits scope
 * text like *"This phase depends on src/modules/leave/leave.model.ts
 * and leave.repository.ts"* per the TR_029 rules; this regex pulls
 * them out so `runAider` can `--read` them.
 *
 * Filters out absolute paths and URL-looking tokens; everything
 * else is forwarded for existsSync-based filtering downstream.
 * Order-preserving, deduplicated.
 */
export function extractMentionedPaths(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(FILE_PATH_RE)) {
    let path = match[1];
    if (!path) continue;
    if (path.includes('://')) continue;       // skip URLs
    if (path.startsWith('/')) continue;       // skip absolute paths
    if (path.startsWith('./')) path = path.slice(2);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
