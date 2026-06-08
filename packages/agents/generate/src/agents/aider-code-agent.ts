/**
 * Aider code agent (TR_014).
 *
 * Drop-in replacement for `CodeAgent` when
 * `HARNESS.json.codeGeneration.backend === 'aider'`. Same
 * orchestrator contract — extends `BaseLLMAgent`, owns
 * `lastPrompt` / `lastLlmResponse` / `lastModelUsed` for the
 * dashboard's accordion, returns an `AgentResult`.
 *
 * Operationally different from the Gestalt-native code-agent:
 *   - Does not call the LLM directly. Aider does.
 *   - Does not produce JSON. Aider's narrative stdout becomes the
 *     "llm_response" the orchestrator persists.
 *   - Edits files directly in the cycle's cloned work-dir.
 *     pr-agent's `git add -A` captures everything Aider wrote.
 *
 * TR_026 — the platform NO LONGER parses Aider's stdout to know
 * which files were written. Per ADR-050 that's the downstream
 * agents' job (gate review-agent, phase-evaluator-agent), using
 * `git diff` via `executeScript`. The only artifact this agent
 * emits is the narrative (design type) so the IntentDetail panel
 * can render Aider's session log.
 *
 * Test files are produced inline by Aider in the same session — the
 * orchestrator skips the test-agent step for Aider-backed projects.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { simpleGit } from 'simple-git';
import type { AgentTask, AgentResult, GeneratedArtifact } from '../types';
import { BaseLLMAgent } from './base-llm-agent';
import { getLLMClientForModel, createContextLogger, getRepositories } from '@gestalt/core';
import { runAider } from '../adapters/aider-adapter';
import { buildAiderMessage } from '../adapters/aider-message-builder';

const log = createContextLogger({ module: 'aider-code-agent' });

export class AiderCodeAgent extends BaseLLMAgent {
  constructor() { super('code-agent'); }

  override async run(task: AgentTask): Promise<AgentResult> {
    this.lastTokensUsed = 0;
    const startedAt = task.startedAt ?? Date.now();
    const { agentConfig, projectRoot, intentSpec, correlationId } =
      buildRunContext(task);

    // Aider reads the same per-agent LLM record as the Gestalt-native
    // code-agent (same model override semantics from agents.yaml).
    // We resolve the client once here so model + baseUrl + apiKey come
    // from the registry-backed resolver — no separate env lookup.
    const client = await getLLMClientForModel(agentConfig.llm.model);
    const modelString = client.getModel();
    const baseUrl = client.getBaseUrl();
    const apiKey = client.getApiKey();
    this.lastModelUsed = modelString;

    // Pull the latest design-spec from the artifacts table — it was
    // produced upstream by design-agent in the same cycle. Missing
    // design-spec is non-fatal (the message builder simply omits the
    // section) so Aider still runs.
    const designSpec = await loadLatestDesignSpec(correlationId);

    const message = buildAiderMessage(intentSpec, designSpec, task.contextSnapshot);
    this.lastPrompt = message;

    log.info(
      {
        correlationId,
        model: modelString,
        projectRoot,
        messageBytes: message.length,
      },
      'Running Aider code generation',
    );

    const result = await runAider(
      message,
      projectRoot,
      modelString,
      apiKey,
      baseUrl,
    );

    // Aider's stdout becomes the row's `llm_response` — the dashboard
    // accordion renders it verbatim so operators see the narrative.
    this.lastLlmResponse = result.output;

    if (!result.success) {
      log.warn(
        {
          correlationId,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stderrPrefix: result.error.slice(0, 200),
        },
        'Aider code generation failed',
      );
      return {
        agentRole: 'code-agent',
        status: 'failed',
        artifacts: [],
        signals: [this.makeContextGapSignal(
          correlationId,
          `Aider code generation failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}): ${result.error.slice(0, 300)}`,
        )],
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    // TR_026 — the agent asks git (not Aider's stdout) what files
    // changed. ADR-050: LLM evaluates, platform routes, AGENTS use
    // git as a tool. Aider's stdout is treated as narrative only.
    // `git status --porcelain` enumerates everything Aider touched
    // in the work-dir without us having to parse natural-language
    // "Applied edit to..." lines.
    const codeArtifacts = await discoverAiderWrites(projectRoot, correlationId);

    const narrativeArtifact: GeneratedArtifact = {
      id: crypto.randomUUID(),
      correlationId,
      type: 'design',
      path: `.gestalt/${correlationId}/aider-output.md`,
      content: renderAiderNarrative(result, message),
      producedBy: 'code-agent',
      createdAt: new Date(),
    };

    log.info(
      {
        correlationId,
        filesFromGit: codeArtifacts.length,
        durationMs: result.durationMs,
      },
      'Aider code generation complete — file list resolved via git',
    );

    return {
      agentRole: 'code-agent',
      status: 'completed',
      artifacts: [...codeArtifacts, narrativeArtifact],
      signals: [],
      tokensUsed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  protected buildPrompt(): string {
    throw new Error('AiderCodeAgent.buildPrompt is not used — see overridden run()');
  }
  protected parseResponse(): AgentResult {
    throw new Error('AiderCodeAgent.parseResponse is not used — see overridden run()');
  }
}

function buildRunContext(task: AgentTask): {
  agentConfig: AgentTask['contextSnapshot']['agentConfig'];
  projectRoot: string;
  intentSpec: AgentTask['contextSnapshot']['intentSpec'];
  correlationId: string;
} {
  const { contextSnapshot } = task;
  return {
    agentConfig: contextSnapshot.agentConfig,
    projectRoot: contextSnapshot.projectRoot,
    intentSpec: contextSnapshot.intentSpec,
    correlationId: task.correlationId,
  };
}

async function loadLatestDesignSpec(correlationId: string): Promise<string | null> {
  try {
    const { artifacts } = getRepositories();
    const all = await artifacts.findByCorrelationId(correlationId);
    // Walk newest-first so a self-healing retry sees the freshest
    // design-spec. The design-agent writes its artifact at
    // `.gestalt/<correlationId>/design-spec.json` by convention.
    const sorted = [...all].sort(
      (a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0),
    );
    const designArtifact = sorted.find((a) =>
      a.path.endsWith('/design-spec.json') || a.path.endsWith('design-spec.json'),
    );
    return designArtifact?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * TR_026 — discover the files Aider wrote by asking git, not by
 * parsing Aider's stdout. Aider runs with `--no-git` so it doesn't
 * commit anything, which means every change shows up as either
 * untracked (`?? path`) or modified (` M path`) in
 * `git status --porcelain`. We read each one and emit it as a code
 * artifact — the orchestrator persists it, pr-agent writes it into
 * its own clone, gate reads it.
 *
 * `.gestalt/` paths are excluded — the narrative artifact emits
 * those from a separate code path and they aren't part of the
 * generated source.
 *
 * Best-effort: a missing or unreadable file logs a warning and is
 * omitted from the artifact set. The gate sees what made it.
 */
async function discoverAiderWrites(
  workDir: string,
  correlationId: string,
): Promise<GeneratedArtifact[]> {
  const git = simpleGit(workDir);
  let status: Awaited<ReturnType<typeof git.status>>;
  try {
    status = await git.status();
  } catch (err) {
    log.warn(
      { correlationId, err: err instanceof Error ? err.message : String(err) },
      'git status failed in Aider work-dir — no code artifacts emitted',
    );
    return [];
  }

  // Untracked (created) + modified + renamed `to` paths. Aider may
  // have written multiple, including deeply nested ones.
  const candidates = new Set<string>([
    ...status.not_added,
    ...status.created,
    ...status.modified,
    ...status.renamed.map((r) => r.to),
  ]);

  const artifacts: GeneratedArtifact[] = [];
  for (const relPath of candidates) {
    if (!relPath || relPath.startsWith('.gestalt/')) continue;
    try {
      const content = await readFile(join(workDir, relPath), 'utf8');
      artifacts.push({
        id: crypto.randomUUID(),
        correlationId,
        type: 'code',
        path: relPath,
        content,
        producedBy: 'code-agent',
        createdAt: new Date(),
      });
    } catch (err) {
      log.warn(
        { correlationId, path: relPath, err: err instanceof Error ? err.message : String(err) },
        'git reported a changed file that could not be read — skipping',
      );
    }
  }
  return artifacts;
}

function renderAiderNarrative(
  result: { output: string; durationMs: number; exitCode: number },
  message: string,
): string {
  return [
    '# Aider session',
    '',
    `**Exit code:** ${result.exitCode}`,
    `**Duration:** ${result.durationMs}ms`,
    '',
    '## Prompt sent to Aider',
    '',
    '```',
    message,
    '```',
    '',
    '## Aider output',
    '',
    '```',
    result.output || '(no stdout)',
    '```',
    '',
  ].join('\n');
}
