/**
 * Harness template engine (ADR-036).
 *
 * Loads a harness template from `templates/<templateId>/` on disk,
 * runs simple `{{variable}}` substitution against the body of every
 * file, and returns the list of files-to-commit + their target paths
 * in the project repo.
 *
 * No logic in substitution — `{{variableName}}` only. Unknown
 * variables are left in place (so a missing value is debuggable in
 * the committed file rather than silently swallowed).
 *
 * Files under `harness/`, `docs/`, and `ci/` are committed. Files
 * under `constraints/`, `principles/`, and the top-level
 * `template.json` / `README.md` are platform-internal and skipped —
 * they describe the template but don't belong in project repos.
 *
 * Repo-path mapping:
 *   harness/AGENTS.md      → AGENTS.md
 *   harness/HARNESS.json   → HARNESS.json
 *   harness/agents.yaml    → agents.yaml
 *   docs/<file>            → docs/<file>
 *   ci/gestalt.yml         → .github/workflows/gestalt.yml
 *
 * Anything else under the template root is committed at its path
 * unchanged (for future template additions).
 */

import { readFile, readdir, access } from 'fs/promises';
import { accessSync } from 'fs';
import { join } from 'path';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'template-engine' });

/** Variables surfaced to template files via `{{name}}`. */
export interface TemplateVariables {
  projectName: string;
  projectDescription: string;
  defaultBranch?: string;
  /** Auto-supplied by the engine when absent: ISO date at load time. */
  today?: string;
  /** Auto-derived from projectName: kebab-cased, lowercased. */
  projectSlug?: string;
  [key: string]: string | undefined;
}

export interface HarnessFile {
  /** Path inside the project repo (e.g. `docs/ARCHITECTURE.md`). */
  repoPath: string;
  /** Substituted content ready to write. */
  content: string;
}

/**
 * Directories below the template root that are platform-internal —
 * the engine walks them but does NOT emit their files into the
 * project repo. Keeps the project-side surface clean while letting
 * the registry / harness engine access constraint + principle
 * metadata via direct reads.
 *
 * Also includes the brace-expansion artifact directory
 * `{harness,principles,constraints}/` that exists in the working
 * tree from an earlier shell mishap — we never want to commit
 * its empty file set.
 */
const SKIP_DIRS = new Set(['constraints', 'principles', '{harness,principles,constraints}']);

/**
 * Top-level files (relative to the template root) that describe the
 * template itself and should never reach a project repo.
 */
const SKIP_FILES = new Set(['template.json', 'README.md']);

/**
 * Loads a harness template and returns the list of files-to-commit
 * with variable substitution applied.
 *
 * `today` and `projectSlug` are auto-supplied when the caller omits
 * them. All other unknown placeholders are left in place.
 */
export async function loadTemplate(
  templatesDir: string,
  templateId: string,
  variables: TemplateVariables,
): Promise<HarnessFile[]> {
  const templateDir = join(templatesDir, templateId);
  await access(templateDir);

  const today = new Date().toISOString().split('T')[0]!;
  const projectSlug =
    variables.projectSlug?.trim()
    || variables.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    || variables.projectName.toLowerCase();
  const vars: TemplateVariables = {
    today,
    defaultBranch: 'main',
    ...variables,
    projectSlug,
  };

  const files: HarnessFile[] = [];
  await collectFiles(templateDir, templateDir, vars, files);
  return files;
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  vars: TemplateVariables,
  files: HarnessFile[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectFiles(baseDir, fullPath, vars, files);
      continue;
    }
    if (!entry.isFile()) continue;
    // Only filter top-level template descriptors — README.md / template.json
    // at the root. README.md nested inside e.g. docs/ would be committed.
    const isTopLevel = currentDir === baseDir;
    if (isTopLevel && SKIP_FILES.has(entry.name)) continue;

    const raw = await readFile(fullPath, 'utf8');
    const content = substitute(raw, vars);
    const templateRelativePath = fullPath.slice(baseDir.length + 1);
    const repoPath = resolveRepoPath(templateRelativePath);
    files.push({ repoPath, content });
  }
}

/**
 * Replaces every `{{key}}` occurrence with `vars[key]`. Leaves
 * unknown keys in place (returning the original `{{key}}` literal)
 * so missing values are debuggable rather than silently empty.
 */
export function substitute(content: string, vars: TemplateVariables): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    if (value === undefined) {
      log.debug({ key }, 'Template variable not supplied — leaving placeholder in place');
      return `{{${key}}}`;
    }
    return value;
  });
}

/**
 * Maps a template-relative path to the path it should land at inside
 * the project repo. `harness/X` → `X` (top level), `ci/gestalt.yml`
 * → `.github/workflows/gestalt.yml`, anything else passes through.
 */
export function resolveRepoPath(templateRelativePath: string): string {
  // Normalise Windows-style separators in case the engine is ever
  // exercised on Windows.
  const p = templateRelativePath.replace(/\\/g, '/');
  if (p.startsWith('harness/')) return p.slice('harness/'.length);
  if (p === 'ci/gestalt.yml')  return '.github/workflows/gestalt.yml';
  return p;
}

/**
 * Resolves the path to `templates/` on disk for the current run.
 *
 *   - Docker production image: `/app/templates` (Dockerfile copies
 *     the directory in).
 *   - `pnpm dev` from `packages/server`: `cwd = packages/server`,
 *     templates live two levels up at the repo root.
 *   - `node dist/server.js` from `packages/server/dist`: same as
 *     above, walk up.
 *   - Anything else: fall back to a brute-force walk-up from the
 *     compiled file's directory.
 *
 * Synchronous on purpose — runs once at module load. The result is
 * cached so subsequent `init-harness` calls don't re-walk.
 */
let _cachedTemplatesDir: string | null = null;
export function resolveTemplatesDir(): string {
  if (_cachedTemplatesDir) return _cachedTemplatesDir;
  const candidates = [
    join(process.cwd(), 'templates'),
    join(process.cwd(), '..', '..', 'templates'),
    join(__dirname, '..', '..', '..', '..', 'templates'),
    join(__dirname, '..', '..', '..', 'templates'),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      _cachedTemplatesDir = candidate;
      log.info({ templatesDir: candidate }, 'Templates directory resolved');
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not locate templates directory. Tried: ${candidates.join(', ')}. ` +
    `In production the Dockerfile must COPY templates ./templates; in local dev ` +
    `the server expects to be started from the repo root or packages/server.`,
  );
}
