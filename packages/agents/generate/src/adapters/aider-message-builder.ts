/**
 * Build the Aider message from the cycle's context snapshot (TR_014).
 *
 * The Aider message is intentionally MINIMAL: the task, the success
 * criteria, the project rules, and the architecture context.
 * **No implementation instructions.** Aider decides how — that's the
 * whole point of using it. We provide the "what" and "why"; Aider
 * provides the "how".
 *
 * TR_032 — the prose "Read PLAN.md first" and "Before generating any
 * code, read every file you import from" sections were removed.
 * Across TR_029 / TR_030 / TR_031 Aider repeatedly ignored those
 * instructions and hallucinated against deployed phase artifacts.
 * The `runAider` adapter now passes those files via the `--read`
 * flag, which forces Aider to PROCESS them — not a polite request.
 * This builder returns the list of paths to inject alongside the
 * message; the caller wires them into the Aider invocation.
 *
 * This is the opposite contract from the Gestalt-native code-agent
 * (which receives a fully spec'd JSON-output prompt with file paths
 * + expected schema). Aider operates on prose tasks and writes
 * files via its own tool loop.
 */

import type { ContextSnapshot, IntentSpec } from '../types';

const MAX_ARCHITECTURE_BYTES = 2000;
const MAX_DESIGN_BYTES = 2000;

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
 * Result of building an Aider message — TR_032 splits the previous
 * single-string return into the message body plus the file list to
 * pass to `runAider` via `--read`.
 */
export interface AiderMessage {
  message: string;
  /**
   * Paths (relative to the project root) the caller should pass to
   * `runAider`'s `readFiles` parameter. PLAN.md is always present.
   * The `runAider` adapter is responsible for filtering this list
   * against `existsSync` before invoking Aider — over-inclusion here
   * is intentional.
   */
  readFiles: string[];
}

export function buildAiderMessage(
  intentSpec: IntentSpec,
  designSpec: string | null,
  snapshot: ContextSnapshot,
): AiderMessage {
  const codeAgentRules =
    snapshot.harness.agentConfig?.['code-agent']?.rules ?? [];
  const architecture = snapshot.architectureMd ?? '';

  // TR_032 — PLAN.md is always cited; scope-mentioned paths are
  // appended. The adapter's existsSync filter handles the case
  // where PLAN.md doesn't exist yet (Phase 1 of a feature).
  // TR_033 — also always cite the common compiler-config + dependency-
  // manifest filenames so Aider sees the project's strictness settings
  // and available dependencies before generating. The existsSync filter
  // naturally drops the ones a project doesn't use (e.g. tsconfig.json
  // on a Python project, pyproject.toml on a TypeScript project), so
  // the list can over-cover languages without harm.
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

  if (architecture.trim().length > 0) {
    sections.push('');
    sections.push('## Project architecture');
    sections.push(architecture.slice(0, MAX_ARCHITECTURE_BYTES));
  }

  if (designSpec && designSpec.trim().length > 0) {
    sections.push('');
    sections.push('## Design context');
    sections.push(designSpec.slice(0, MAX_DESIGN_BYTES));
  }

  sections.push('');
  sections.push('## Important — architecture context is reference only');
  sections.push(
    'The architecture and design context above describes the intended\n' +
      'system design. Many modules and types it mentions DO NOT EXIST\n' +
      'YET in the repository — they are planned for future phases.\n' +
      'Only import from files that actually exist in the repository.\n' +
      'Use your repository map to verify a file exists before importing it.',
  );

  return {
    message: sections.join('\n').trim(),
    readFiles,
  };
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
