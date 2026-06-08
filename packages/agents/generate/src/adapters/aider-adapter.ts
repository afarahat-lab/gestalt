/**
 * Aider adapter (TR_014).
 *
 * Replaces the code-agent + test-agent for projects opted in via
 * `HARNESS.json.codeGeneration.backend: 'aider'`. Gestalt provides
 * what to do (the intent + project rules + architecture context).
 * Aider decides how — it runs as a child process, edits files
 * directly in the cycle's cloned work-dir, and emits a narrative of
 * what it changed.
 *
 * Lifecycle invariants:
 *   --no-git is mandatory. The deploy layer's pr-agent is the sole
 *   git surface; Aider must not commit. AIDER_NO_AUTO_COMMITS=true
 *   is also set as a belt-and-braces guard for older Aider
 *   versions that auto-commit even with --no-git.
 *
 *   --yes-always is mandatory. Aider is interactive by default;
 *   the server has no TTY. TR_026 raised this from `--yes` to
 *   `--yes-always` to prevent silent hangs on confirmation prompts
 *   Aider sometimes inserts mid-session.
 *
 *   Credentials are forwarded as OPENAI_API_KEY + OPENAI_API_BASE
 *   environment variables (extraEnv to executeScript) — never via
 *   command-line flags, which would leak into the process listing.
 *
 * TR_026 — the platform NO LONGER parses Aider's stdout to detect
 * which files changed. Per ADR-050 that is the agent's job, using
 * git (via `executeScript`) on the actual repo. The `filesChanged`
 * field on this result was deleted; downstream agents read the
 * truth from git, not from Aider's narrative.
 */

import { executeScript } from '@gestalt/core';

export interface AiderResult {
  success: boolean;
  /** Aider's stdout — the narrative of what it changed. */
  output: string;
  /** Aider's stderr — populated on failure. */
  error: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

const DEFAULT_AIDER_TIMEOUT_MS = 120_000;

/**
 * Run Aider against the supplied work-dir with the supplied message.
 * Returns a typed result — never throws. The caller decides whether
 * a non-zero exit code is a hard failure (e.g. code-agent failure
 * path) or recoverable (e.g. self-healing retry).
 */
export async function runAider(
  message: string,
  workDir: string,
  modelString: string,
  apiKey: string,
  baseUrl?: string,
  timeoutMs: number = DEFAULT_AIDER_TIMEOUT_MS,
): Promise<AiderResult> {
  // `--message` is shell-quoted with double-quotes. Escape any
  // embedded double-quote in the message so the boundary remains
  // valid. Backticks, dollar signs, and backslashes also need
  // escaping inside double-quoted shell strings.
  const escapedMessage = message
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');

  // --yes-always — TR_026: never prompt for confirmation. Aider
  //                sometimes injects mid-session prompts ("Apply
  //                this change?") that hang on a TTY-less server.
  //                `--yes-always` is the stronger form of `--yes`.
  // --no-git     — pr-agent owns every git op (clone / commit / push).
  // --model      — model string forwarded from the platform LLM
  //                registry; uses the same routing as the rest of
  //                the code-agent path.
  // --message    — single-shot prompt; Aider exits after applying.
  const command = [
    'aider',
    '--yes-always',
    '--no-git',
    `--model "${modelString}"`,
    `--message "${escapedMessage}"`,
  ].join(' ');

  const result = await executeScript(command, workDir, timeoutMs, {
    OPENAI_API_KEY: apiKey,
    OPENAI_API_BASE: baseUrl ?? 'https://api.openai.com/v1',
    AIDER_NO_AUTO_COMMITS: 'true',
  });

  return {
    success: result.exitCode === 0,
    output: result.stdout,
    error: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  };
}
