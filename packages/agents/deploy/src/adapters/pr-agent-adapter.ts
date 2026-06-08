/**
 * PR-Agent adapter (TR_027 / ADR-051).
 *
 * Invokes CodiumAI PR-Agent (https://github.com/Codium-ai/pr-agent)
 * as a SERVER-SIDE subprocess inside the Gestalt container. The
 * deploy-orchestrator calls `runPrAgentReview(...)` after CI
 * passes; PR-Agent reads the PR diff via GitHub API, asks the
 * LLM to review it, and posts a review comment on the PR.
 * pipeline-agent then polls the PR for the review verdict via
 * `GitHubActionsAdapter.getPrAgentVerdict`.
 *
 * Architecture invariants:
 *   - PR-Agent is installed in the server's Docker image (pip)
 *     alongside Aider.
 *   - LLM credentials are resolved from Gestalt's registry per
 *     invocation and forwarded via subprocess environment.
 *     PR-Agent never sees the vault or the registry — it gets
 *     the resolved baseUrl + apiKey + model for THIS run only.
 *   - GitHub token is the project's vault PAT (same one
 *     pr-agent / pipeline-agent already use for the repo).
 *   - `.pr_agent.toml` committed at the project repo root drives
 *     PR-Agent's per-project review focus (rules from HARNESS.json).
 *
 * Failure semantics: throws on infrastructure error; returns
 * `{ exitCode != 0 }` on PR-Agent execution failure. The caller
 * decides whether to fall back to the legacy review-agent path
 * or escalate.
 */

import { executeScript } from '@gestalt/core';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'pr-agent-adapter' });

export interface PrAgentResult {
  /** Process exit code; 0 ⇒ PR-Agent ran successfully. */
  exitCode: number;
  /** PR-Agent's stdout (its narrative of what it did). */
  output: string;
  /** PR-Agent's stderr — populated on failure. */
  error: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run PR-Agent against `prUrl` with the LLM credentials Gestalt
 * already resolved. Best-effort env-var mapping covers Azure
 * OpenAI, OpenAI-compatible endpoints (Ollama, vLLM, native
 * OpenAI), and the standard `chat-completions` shape.
 *
 * `apiShape` matters: PR-Agent's litellm-backed clients expect
 * `OPENAI__API_VERSION` for Azure but not for OpenAI / Ollama.
 *
 * Never throws — returns a typed result the caller can inspect.
 */
export async function runPrAgentReview(args: {
  prUrl: string;
  projectRoot: string;
  llmRecord: {
    modelString: string;
    baseUrl: string;
    apiShape: 'chat-completions' | 'responses';
    provider: string;
  };
  apiKey: string;
  githubToken: string;
  /** Per-invocation timeout. Defaults to 60s. */
  timeoutMs?: number;
  correlationId?: string;
}): Promise<PrAgentResult> {
  const timeoutMs = args.timeoutMs ?? 60_000;
  // Common env vars across providers. PR-Agent reads
  // `GITHUB__USER_TOKEN` for the GitHub API and `CONFIG__MODEL`
  // for the LLM model name.
  const env: Record<string, string> = {
    GITHUB__USER_TOKEN: args.githubToken,
    CONFIG__MODEL: args.llmRecord.modelString,
  };

  // Provider-specific env: Azure needs an API version; everything
  // else (OpenAI / Ollama / vLLM / OpenAI-compatible proxies)
  // reads the base URL + key.
  const isAzure =
    args.llmRecord.baseUrl.toLowerCase().includes('azure')
    || args.llmRecord.provider.toLowerCase() === 'azure';
  if (isAzure) {
    env['OPENAI__API_TYPE'] = 'azure';
    env['OPENAI__API_BASE'] = args.llmRecord.baseUrl;
    env['OPENAI__API_VERSION'] = '2024-02-01';
    env['OPENAI__KEY'] = args.apiKey;
  } else {
    env['OPENAI__API_BASE'] = args.llmRecord.baseUrl;
    env['OPENAI__KEY'] = args.apiKey;
  }

  // Quote the PR URL so shell metacharacters in the URL (rare but
  // possible — branch names with `&` etc.) don't break the call.
  // Escape any embedded double-quote.
  //
  // `pr-agent` is a Dockerfile-installed shim that resolves to the
  // dedicated /opt/pr-agent venv so its dep graph (litellm in
  // particular) doesn't collide with Aider's.
  const escapedUrl = args.prUrl.replace(/"/g, '\\"');
  const command = `pr-agent --pr_url="${escapedUrl}" review`;

  log.info(
    {
      prUrl: args.prUrl,
      model: args.llmRecord.modelString,
      baseUrl: args.llmRecord.baseUrl,
      isAzure,
      correlationId: args.correlationId,
    },
    'Running PR-Agent review (server-side)',
  );

  const result = await executeScript(command, args.projectRoot, timeoutMs, env);

  return {
    exitCode: result.exitCode,
    output: result.stdout,
    error: result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  };
}
