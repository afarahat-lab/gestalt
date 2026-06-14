/**
 * AiderBackend — `CodeAgentBackend` implementation for Aider.
 *
 * Every Aider-specific detail (CLI flag names, env var names,
 * litellm provider-prefix routing, escape rules) lives inside this
 * file. The platform calls `aiderBackend.run(context)`; everything
 * else is internal.
 *
 * Behavioural invariants — Aider semantics, NOT platform policy:
 *
 *   --no-git is mandatory. The deploy layer's pr-agent is the sole
 *   git surface; Aider must not commit. `AIDER_NO_AUTO_COMMITS=true`
 *   is also set as a belt-and-braces guard for older Aider versions
 *   that auto-commit even with --no-git.
 *
 *   --yes-always is mandatory. Aider is interactive by default; the
 *   server has no TTY. TR_026 raised this from `--yes` to
 *   `--yes-always` to prevent silent hangs on confirmation prompts
 *   Aider sometimes inserts mid-session.
 *
 *   Credentials are forwarded as OPENAI_API_KEY + OPENAI_API_BASE
 *   environment variables — never via command-line flags, which
 *   would leak into the process listing.
 *
 *   --test-cmd + --auto-test (and --lint-cmd + --auto-lint) are
 *   set when `context.verification` carries a command. When they
 *   are set, Aider iterates: write → run cmd → if non-zero, re-ask
 *   the LLM until cmd passes or the timeout fires. Closes the
 *   failure mode where Aider declared complete but `npm run build`
 *   / `npm test` failed downstream at CI time.
 *
 * History (constants previously lived in the deleted
 * `aider-adapter.ts`):
 *
 *   - DEFAULT_TIMEOUT_MS = 900_000 (TR_050) — Aider's subprocess
 *     wraps one or more model round-trips; on slower DeepInfra-
 *     hosted models (Kimi-K2.6 at 8k+ tokens per response) a single
 *     Aider session can easily exceed the per-LLM-call timeout.
 *   - `--timeout 600` — Aider's own per-LLM-call HTTP timeout
 *     (passed through to litellm/httpx). The 600s aligns with the
 *     LLM_TIMEOUT_MS the platform's native client uses, and stays
 *     well under the 900s subprocess ceiling so retries still fit.
 *   - `openai/` prefix — TR_050: Aider routes its API call through
 *     litellm, which requires a provider prefix. The platform LLM
 *     registry stores wire-level model names without a prefix
 *     because the Gestalt-native client talks to OpenAI-compat
 *     endpoints directly. We prepend `openai/` for non-prefixed
 *     models so litellm uses the OpenAI provider, which honours
 *     `OPENAI_API_BASE` and routes to whatever provider the registry
 *     pointed us at (DeepInfra, Together, Fireworks, etc.).
 *
 * TR_026 — the platform does NOT parse Aider's stdout to detect
 * which files changed. The agent calls git on the actual repo
 * (`git status --porcelain`) after the backend returns. Aider's
 * stdout becomes the human-readable `output` narrative only.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { executeScript } from '@gestalt/core';
import type { CodeAgentBackend, CodeAgentContext, CodeAgentResult } from './types';

const DEFAULT_TIMEOUT_MS = 900_000;

/** Known litellm provider prefixes — model names already starting with
 *  any of these are routed correctly and pass through untouched.
 *  Anything else gets `openai/` prepended so litellm uses the OpenAI
 *  provider (which then honours OPENAI_API_BASE → DeepInfra/etc.). */
const LITELLM_PROVIDER_PREFIXES = [
  'openai/', 'anthropic/', 'azure/', 'vertex_ai/', 'bedrock/',
  'together_ai/', 'fireworks_ai/', 'huggingface/', 'replicate/',
  'cohere/', 'ollama/', 'groq/', 'mistral/', 'deepseek/',
  'perplexity/', 'gemini/', 'xai/',
];

function applyLitellmPrefix(modelName: string): string {
  const hasPrefix = LITELLM_PROVIDER_PREFIXES.some(
    (p) => modelName.startsWith(p),
  );
  return hasPrefix ? modelName : `openai/${modelName}`;
}

/**
 * Shell-escape the `--message` body for a double-quoted Aider arg.
 * Backslash / double-quote / dollar sign / backtick all need escaping
 * inside double-quoted shell strings.
 */
function escapeForShellDoubleQuotes(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

class AiderBackendImpl implements CodeAgentBackend {
  readonly name = 'aider';

  async run(context: CodeAgentContext): Promise<CodeAgentResult> {
    const {
      message, workDir, model, readFiles,
      verification, timeoutMs, correlationId,
    } = context;

    const escapedMessage = escapeForShellDoubleQuotes(message);

    // --read flags — filter to files that actually exist in workDir.
    // The planner sometimes cites a path the phase itself is about to
    // create; passing it to Aider would make Aider error before
    // writing anything.
    const readFlags = readFiles
      .filter((f) => f.length > 0 && existsSync(join(workDir, f)))
      .map((f) => `--read "${f.replace(/"/g, '\\"')}"`)
      .join(' ');

    const aiderModel = applyLitellmPrefix(model.name);

    // Verification flags. Aider's `--test-cmd` takes a single
    // shell command; when paired with `--auto-test` Aider runs the
    // command after each edit and feeds non-zero output back to the
    // LLM until the test passes (bounded by the LLM-call timeout).
    //
    // Strategy: chain build + test into a single `--test-cmd`
    // (Aider supports only one). Run build first; if build fails we
    // never reach the test step but the LLM still sees the build
    // error. This catches both compilation errors and test failures
    // at edit time, not at CI time.
    const verificationFlags: string[] = [];
    const verify = verification ?? {};
    const chained = [verify.buildCmd, verify.testCmd]
      .filter((c): c is string => typeof c === 'string' && c.length > 0)
      .join(' && ');
    if (chained.length > 0) {
      verificationFlags.push(`--test-cmd "${chained.replace(/"/g, '\\"')}"`);
      verificationFlags.push('--auto-test');
    }
    if (verify.lintCmd && verify.lintCmd.length > 0) {
      // Aider's --lint-cmd format is `<lang>:<cmd>`. We don't know
      // the language at this layer, so use the underscore form
      // Aider accepts as a universal lint hook.
      verificationFlags.push(`--lint-cmd "${verify.lintCmd.replace(/"/g, '\\"')}"`);
      verificationFlags.push('--auto-lint');
    }

    const command = [
      'aider',
      '--yes-always',
      '--no-git',
      '--timeout 600',
      ...verificationFlags,
      readFlags,
      `--model "${aiderModel}"`,
      `--message "${escapedMessage}"`,
    ]
      .filter((part) => part.length > 0)
      .join(' ');

    const result = await executeScript(
      command,
      workDir,
      timeoutMs ?? DEFAULT_TIMEOUT_MS,
      {
        OPENAI_API_KEY: model.apiKey,
        OPENAI_API_BASE: model.baseUrl ?? 'https://api.openai.com/v1',
        AIDER_NO_AUTO_COMMITS: 'true',
        // Hint for log-correlation when operators tail container logs
        // and want to thread Aider's stdout to a specific cycle.
        GESTALT_CORRELATION_ID: correlationId,
      },
    );

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };
  }
}

/** Singleton — stateless, no reason to construct more than once. */
export const aiderBackend: CodeAgentBackend = new AiderBackendImpl();
