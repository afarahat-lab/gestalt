/**
 * Context-file fixer for additive maintenance intents (ADR-018).
 *
 * ADR-018 permits the maintenance layer to apply direct fixes ONLY for
 * additive documentation updates — never for src/ files, never as
 * destructive rewrites. This module is the only path that exercises
 * that exception.
 *
 * Used by the runner when a queued `MaintenanceIntent`'s class is
 * `'context-file-update'` (i.e. `CONTEXT_ALIGNMENT` / `CONTEXT_UPDATE`).
 * Performance + security intents do NOT come through here — they keep
 * flowing through the generate orchestrator.
 *
 * Guarantees (enforced in this file):
 *   1. Target file is in `docs/` or is exactly `AGENTS.md`. Anything
 *      else throws BEFORE any LLM call. No way to silently write to
 *      `src/`.
 *   2. LLM output shorter than 50% of the original file is rejected
 *      as suspected truncation. The temp dir is cleaned, no commit
 *      happens. Operator must intervene.
 *   3. All Git operations go through `simple-git`. Temp dir cleaned in
 *      a `finally` block on every code path.
 *   4. Commit author is `Gestalt Maintenance Agent`, message prefixed
 *      `docs:` with the suggestedAction (prefix stripped) and a
 *      `[gestalt-maintenance]` trailer.
 */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import {
  createContextLogger, getLLMClient,
} from '@gestalt/core';
import type { MaintenanceIntent } from '../types';
import { authenticatedGitUrl, maintenanceIntentPrefix } from './util';

const log = createContextLogger({ module: 'context-fixer' });

/** Minimum fraction of the original length the LLM output must clear. */
const TRUNCATION_FLOOR = 0.5;

/** Fixed allowlist — see ADR-018. */
const PROTECTED_PREFIX = 'docs/';
const PROTECTED_FILES = ['AGENTS.md'];

export interface ContextFixProject {
  projectId: string;
  projectName: string;
  projectGitUrl: string;
  token: string;
  defaultBranch: string;
}

export interface ContextFixOutcome {
  committed: boolean;
  /** Set when `committed === true`. */
  commitSha?: string;
  /** Set when `committed === false` — human-readable reason for skipping. */
  reason?: 'no-change' | 'truncation-guard' | 'file-missing' | 'llm-error';
}

/**
 * Applies a `context-file-update` maintenance intent directly to the
 * project's `defaultBranch`. The caller (runner) decides whether to
 * increment `directFixes` based on the returned `committed` flag.
 */
export async function applyContextFileFix(
  intent: MaintenanceIntent,
  project: ContextFixProject,
): Promise<ContextFixOutcome> {
  // Path guard — runs BEFORE any clone or LLM call. ADR-018 says the
  // direct-fix path may touch only docs/ and AGENTS.md.
  const targetFile = intent.affectedFiles[0];
  if (!targetFile) {
    throw new Error(
      `applyContextFileFix: intent has no affectedFiles (type=${intent.type}, project=${project.projectId})`,
    );
  }
  if (!isAllowedTarget(targetFile)) {
    throw new Error(
      `applyContextFileFix: refusing to write to '${targetFile}' — only docs/* and AGENTS.md are permitted (ADR-018, ${intent.type})`,
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), `gestalt-ctxfix-${project.projectId}-`));
  try {
    const cloneUrl = authenticatedGitUrl(project.projectGitUrl, project.token);
    log.info(
      { projectId: project.projectId, targetFile, workDir, intentType: intent.type },
      'Applying direct context fix',
    );
    await simpleGit().clone(cloneUrl, workDir);
    const repo = simpleGit(workDir);
    try {
      await repo.checkout(project.defaultBranch);
    } catch {
      // Branch may not exist on a fresh repo — keep going on the
      // detached HEAD; push below will create the ref.
    }

    const filePath = join(workDir, targetFile);
    const currentContent = await readFile(filePath, 'utf8').catch(() => null);
    if (currentContent === null) {
      log.warn(
        { projectId: project.projectId, targetFile },
        'Target context file does not exist — skipping direct fix',
      );
      return { committed: false, reason: 'file-missing' };
    }

    const newContent = await generateUpdatedContent({
      targetFile,
      currentContent,
      intent,
    });
    if (newContent === null) {
      return { committed: false, reason: 'llm-error' };
    }

    // Truncation guard — LLMs sometimes return only the changed lines,
    // a summary, or a single sentence. ADR-018 is additive-only; a
    // shorter file is suspected truncation, refuse to write it.
    if (newContent.length < currentContent.length * TRUNCATION_FLOOR) {
      log.warn(
        {
          projectId: project.projectId,
          targetFile,
          originalLength: currentContent.length,
          newLength: newContent.length,
        },
        'LLM output below truncation floor — aborting direct fix',
      );
      return { committed: false, reason: 'truncation-guard' };
    }

    if (newContent === currentContent) {
      log.info(
        { projectId: project.projectId, targetFile },
        'LLM-generated content matches existing file — nothing to commit',
      );
      return { committed: false, reason: 'no-change' };
    }

    await writeFile(filePath, newContent, 'utf8');

    await repo.addConfig('user.name', 'Gestalt Maintenance Agent');
    await repo.addConfig('user.email', 'maintenance-agent@gestalt.local');
    await repo.add('.');
    const status = await repo.status();
    if (status.files.length === 0) {
      return { committed: false, reason: 'no-change' };
    }

    const commitMessage = buildCommitMessage(intent);
    await repo.commit(commitMessage);
    await repo.push('origin', project.defaultBranch);
    const head = await repo.revparse(['HEAD']);

    log.info(
      {
        projectId: project.projectId,
        targetFile,
        commitSha: head.trim(),
        commitMessage,
      },
      'Direct context fix committed',
    );

    return { committed: true, commitSha: head.trim() };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

function isAllowedTarget(path: string): boolean {
  if (path.startsWith(PROTECTED_PREFIX)) return true;
  return PROTECTED_FILES.includes(path);
}

/**
 * Asks the LLM to produce the full updated file content. The prompt
 * emphasises additive minimality and full-file return; the truncation
 * guard upstream catches the common LLM failure of returning only the
 * delta.
 */
async function generateUpdatedContent(args: {
  targetFile: string;
  currentContent: string;
  intent: MaintenanceIntent;
}): Promise<string | null> {
  const { targetFile, currentContent, intent } = args;
  const llm = getLLMClient();

  const system =
    `You are a technical writer updating project context files (markdown / plain text). ` +
    `Make the MINIMAL change needed to address the finding described by the maintenance agent. ` +
    `Preserve ALL existing content — do not delete sections, do not rewrite headings, do not ` +
    `compress paragraphs. Your output is the COMPLETE updated file content from the first ` +
    `character to the last. Return only the file content with no commentary, no markdown code ` +
    `fences, and no explanation.`;

  const user =
    `File: ${targetFile}\n\n` +
    `Current content:\n` +
    `<<<FILE\n${currentContent}\nFILE>>>\n\n` +
    `Finding: ${intent.evidence}\n\n` +
    `Suggested action: ${stripMaintenancePrefix(intent.suggestedAction)}\n\n` +
    `Return the complete updated file content (everything between FILE markers above, with ` +
    `your minimal additive edit applied). Do not include the FILE markers.`;

  const result = await llm.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 8192,
    temperature: 0.2,
    correlationId: `ctxfix-${intent.projectId}-${intent.type}`,
  });

  if (!result.ok) {
    log.warn({ error: result.error, targetFile }, 'LLM call failed during context fix');
    return null;
  }

  return stripFences(result.value.content);
}

function stripFences(text: string): string {
  // Defence-in-depth — the system prompt asks for no fences, but
  // OpenAI-compatible providers sometimes wrap markdown anyway.
  return text
    .replace(/^```(?:markdown|md|text|plain)?\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim() + '\n';  // trailing newline matches the typical file shape
}

function stripMaintenancePrefix(text: string): string {
  // Strip `[gestalt-maintenance/<TYPE>] ` if present so the LLM and
  // the commit message both see a human-readable action.
  return text.replace(/^\[gestalt-maintenance\/[A-Z_]+\]\s*/, '');
}

function buildCommitMessage(intent: MaintenanceIntent): string {
  const clean = stripMaintenancePrefix(intent.suggestedAction);
  const oneLine = clean.split('\n')[0]?.trim() ?? clean.trim();
  const subject = oneLine.length > 72 ? oneLine.slice(0, 69) + '...' : oneLine;
  // Trailer mirrors the maintenance-prefix on the intent text so an
  // operator running `git log --grep='[gestalt-maintenance]'` finds
  // every direct-fix commit.
  return `docs: ${subject} ${maintenanceIntentPrefix(intent.type)}`;
}
