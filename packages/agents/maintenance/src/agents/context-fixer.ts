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
 *
 * Class shape: `ContextFixer` extends `BaseLLMAgent` for the shared
 * `callLLMWithMessages` helper (per-agent model routing via Step 1's
 * multi-client registry, instance-captured `lastPrompt` /
 * `lastLlmResponse` / `lastModelUsed`). The agent has its own entry
 * point `applyFix(intent, project)` because context-fixer is called
 * by the maintenance runner per-finding, not via the standard
 * `AgentTask` shape — so `buildPrompt` / `parseResponse` from the
 * base template are stubbed.
 */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import { createContextLogger } from '@gestalt/core';
import { loadAgentConfig, BaseLLMAgent } from '@gestalt/core';
import type { AgentConfig } from '@gestalt/core';
import type { AgentResult } from '@gestalt/agents-generate';
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

export class ContextFixer extends BaseLLMAgent {
  constructor() { super('context-fixer'); }

  /**
   * Applies a `context-file-update` maintenance intent directly to the
   * project's `defaultBranch`. The caller (runner) decides whether to
   * increment `directFixes` based on the returned `committed` flag.
   */
  async applyFix(
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

      // Step 1 of agent externalisation — context-fixer's role/goal/
      // extensions + LLM tuning come from agents.yaml in the just-cloned
      // project repo. Loader falls back to per-role defaults when the
      // file isn't present.
      const agentConfig = await loadAgentConfig(workDir, 'context-fixer');

      const newContent = await this.generateUpdatedContent({
        targetFile,
        currentContent,
        intent,
        agentConfig,
        projectRoot: workDir,
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

  /**
   * Asks the LLM to produce the full updated file content via a
   * system + user message pair (system carries the ADR-018 rules so
   * the user content can't override them). Routes through the
   * inherited `callLLMWithMessages` so model + temperature + maxTokens
   * come from the per-agent config and `lastModelUsed` is captured
   * on the instance.
   *
   * The prompt emphasises additive minimality and full-file return;
   * the truncation guard upstream catches the common LLM failure of
   * returning only the delta.
   */
  private async generateUpdatedContent(args: {
    targetFile: string;
    currentContent: string;
    intent: MaintenanceIntent;
    agentConfig: AgentConfig;
    projectRoot: string;
  }): Promise<string | null> {
    const { targetFile, currentContent, intent, agentConfig, projectRoot } = args;

    // Persona built from agents.yaml — the original "technical writer"
    // role is the per-role default in agent-config-loader.ts, so
    // removing the agents.yaml file recovers identical behaviour.
    const persona =
      `You are ${agentConfig.role} working on the Gestalt platform.\n` +
      `Your goal: ${agentConfig.goal}\n`;

    const extensions = agentConfig.promptExtensions.length > 0
      ? `\n## Project-specific instructions\n\n${agentConfig.promptExtensions.map((e) => `- ${e}`).join('\n')}\n`
      : '';

    const system =
      `${persona}\n` +
      `Rules you MUST follow:\n` +
      `1. Make only the change needed to address the finding. Do not rewrite, restructure, or ` +
      `summarise existing content.\n` +
      `2. Preserve ALL existing text. Do not delete sections, change headings, or compress ` +
      `paragraphs.\n` +
      `3. Do NOT add \`> Note:\` or other blockquotes that restate the finding or describe what ` +
      `needs to be done. If you cannot make a real structural edit that resolves the finding, ` +
      `return the file UNCHANGED.\n` +
      `4. Your edit must be something that, on the next alignment / drift check, would mean this ` +
      `finding no longer fires. If you cannot achieve that, return the file unchanged.\n` +
      `5. Return only the complete updated file content — no explanation, no preamble, no ` +
      `markdown code fences.` +
      extensions;

    const user =
      `File: ${targetFile}\n\n` +
      `Current content:\n` +
      `<<<FILE\n${currentContent}\nFILE>>>\n\n` +
      `Finding: ${intent.evidence}\n\n` +
      `Suggested action: ${stripMaintenancePrefix(intent.suggestedAction)}\n\n` +
      `Return the complete updated file content (everything between the FILE markers above, ` +
      `with your minimal real edit applied OR unchanged if no real edit is possible). Do not ` +
      `include the FILE markers.`;

    // Fall back to the previous defaults (8192 / 0.2) when the agent
    // config doesn't override them — preserves byte-for-byte behaviour
    // against the pre-refactor implementation.
    const cfg: AgentConfig = {
      ...agentConfig,
      llm: {
        ...agentConfig.llm,
        maxTokens: agentConfig.llm.maxTokens ?? 8192,
        temperature: agentConfig.llm.temperature ?? 0.2,
      },
    };

    try {
      // Amendment 2026-06 (follow-up) — context-fixer now drives the
      // tool-use loop via `callLLMWithToolsMessages`. Same system+user
      // pair the previous `callLLMWithMessages` path used, but the
      // model can now `readFile` / `listDirectory` against the
      // cloned tree to verify file state before producing its edit.
      // Falls through to a plain LLM call when the operator strips
      // `tools.builtin` from the context-fixer entry in agents.yaml.
      const { response: content, toolCallLog } = await this.callLLMWithToolsMessages(
        [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        `${system}\n\n${user}`,
        cfg,
        projectRoot,
        `ctxfix-${intent.projectId}-${intent.type}`,
      );
      // Surface the tool-call summary in logs so operators can verify
      // the tool-use loop fired (context-fixer's invocation isn't
      // persisted in `agent_execution_logs` today — the direct-fix
      // path doesn't create an intents row to anchor to).
      log.info(
        {
          targetFile,
          intentType: intent.type,
          toolCallCount: toolCallLog.length,
          toolNames: toolCallLog.map((t) => t.toolName),
          modelUsed: this.lastModelUsed,
        },
        'context-fixer LLM call completed',
      );
      return stripFences(content);
    } catch (err) {
      log.warn({ err, targetFile }, 'LLM call failed during context fix');
      return null;
    }
  }

  // BaseLLMAgent abstract methods — context-fixer doesn't use the
  // standard run(AgentTask) template; it has applyFix(intent,
  // project) as its entry point. The abstracts must compile but
  // would only run if someone called context-fixer through the
  // generate-orchestrator factory, which it isn't.
  protected buildPrompt(): string {
    throw new Error('ContextFixer.buildPrompt is not used — see applyFix(intent, project)');
  }
  protected parseResponse(): AgentResult {
    throw new Error('ContextFixer.parseResponse is not used — see applyFix(intent, project)');
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

function isAllowedTarget(path: string): boolean {
  if (path.startsWith(PROTECTED_PREFIX)) return true;
  return PROTECTED_FILES.includes(path);
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
