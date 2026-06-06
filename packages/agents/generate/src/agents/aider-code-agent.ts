/**
 * Aider code agent (TR_014).
 *
 * Drop-in replacement for `CodeAgent` when
 * `HARNESS.json.codeGeneration.backend === 'aider'`. Same
 * orchestrator contract — extends `BaseLLMAgent`, owns
 * `lastPrompt` / `lastLlmResponse` / `lastModelUsed` for the
 * dashboard's accordion, returns an `AgentResult` with a `code`
 * artifact for every file Aider wrote.
 *
 * Operationally different from the Gestalt-native code-agent:
 *   - Does not call the LLM directly. Aider does.
 *   - Does not produce JSON. Aider's narrative stdout becomes the
 *     "llm_response" the orchestrator persists.
 *   - Reads the Aider-written files back from the cycle's cloned
 *     work-dir so they land as artifacts in the DB exactly like
 *     code-agent output. The gate sees them; pr-agent writes them
 *     into its own clone for push.
 *
 * Test files are produced inline by Aider in the same session — the
 * orchestrator skips the test-agent step for Aider-backed projects.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
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

    // Aider wrote files directly to the work-dir. Read them back as
    // artifacts so the gate + deploy layers see them. Files Aider
    // listed but that don't exist on disk (race / parse error)
    // surface as a warning — they're omitted from the artifact set
    // and the gate will see what made it.
    const artifacts = await readWrittenFiles(
      result.filesChanged,
      projectRoot,
      correlationId,
    );

    // Surface Aider's narrative as a design-type artifact so it's
    // visible in the IntentDetail panel alongside the generated
    // code. Path includes a short correlation prefix so re-runs
    // don't collide.
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
        filesReported: result.filesChanged.length,
        filesPersisted: artifacts.length,
        durationMs: result.durationMs,
      },
      'Aider code generation complete',
    );

    return {
      agentRole: 'code-agent',
      status: 'completed',
      artifacts: [...artifacts, narrativeArtifact],
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

async function readWrittenFiles(
  paths: string[],
  projectRoot: string,
  correlationId: string,
): Promise<GeneratedArtifact[]> {
  const artifacts: GeneratedArtifact[] = [];
  for (const relPath of paths) {
    // Aider sometimes prefixes paths with `./` or includes trailing
    // commentary like " (new)". Normalise before reading.
    const cleaned = relPath
      .replace(/^\.\//, '')
      .replace(/\s+\(new\)$/i, '')
      .replace(/\s+\(modified\)$/i, '')
      .trim();
    if (cleaned.length === 0) continue;
    try {
      const content = await readFile(join(projectRoot, cleaned), 'utf8');
      artifacts.push({
        id: crypto.randomUUID(),
        correlationId,
        type: 'code',
        path: cleaned,
        content,
        producedBy: 'code-agent',
        createdAt: new Date(),
      });
    } catch (err) {
      log.warn(
        {
          correlationId,
          path: cleaned,
          err: err instanceof Error ? err.message : String(err),
        },
        'Aider reported writing a file but it was not readable — skipping',
      );
    }
  }
  return artifacts;
}

function renderAiderNarrative(
  result: { output: string; filesChanged: string[]; durationMs: number; exitCode: number },
  message: string,
): string {
  const lines = [
    '# Aider session',
    '',
    `**Exit code:** ${result.exitCode}`,
    `**Duration:** ${result.durationMs}ms`,
    `**Files changed:** ${result.filesChanged.length}`,
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
  ];
  if (result.filesChanged.length > 0) {
    lines.push('## Files written');
    lines.push('');
    for (const p of result.filesChanged) {
      lines.push(`- ${p}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
