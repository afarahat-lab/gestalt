/**
 * CodeAgentBackend — pluggable code-generation tool surface.
 *
 * The platform passes a **context object** to a backend; the backend
 * decides HOW to invoke its underlying tool (Aider, Claude Code,
 * Cursor CLI, Continue, …). The platform never knows what CLI flags
 * Aider takes, what env vars Claude Code needs, or how Cursor surfaces
 * test commands. Adding a new tool is a new file under `backends/`
 * implementing this interface; the platform code stays untouched.
 *
 * Rationale (ADR-058 spirit applied to the code-agent step): platform
 * orchestrates and routes; the agent's tool owns its own
 * surface. The platform-knows-Aider-CLI coupling that lived in
 * `aider-adapter.ts` made every Aider flag change a platform-code
 * change and would have made adding Claude Code a code-and-redeploy
 * sweep across the orchestrator.
 *
 * Selection: a project picks a backend via
 * `HARNESS.codeGeneration.backend: 'aider' | 'gestalt' | …`. The
 * factory `getCodeAgentBackend(name)` resolves the registered
 * implementation; unknown names throw at boot, not at runtime.
 */

/**
 * Everything the platform hands a backend for one generation pass.
 * All fields are data — no closures, no platform-internal types
 * exposed across this boundary so the contract stays auditable.
 */
export interface CodeAgentContext {
  /**
   * The fully-assembled prompt body the backend should send to its
   * underlying LLM. Today this is the output of `buildAiderMessage`
   * for Aider; other backends may treat it as their primary user
   * message (Claude Code's slash-command body, Cursor's chat
   * message, etc.). Backends MUST NOT mutate it beyond their own
   * tool's escaping requirements.
   */
  message: string;
  /**
   * Cloned project work-dir on disk, post-checkout. The backend
   * runs the underlying tool here; file edits land relative to
   * this path. The platform owns the lifecycle (clone before,
   * read+commit after) — the backend just generates.
   */
  workDir: string;
  /**
   * Model + auth resolved by the platform from agents.yaml + the
   * LLM registry. The backend forwards as appropriate (Aider →
   * litellm-style provider prefix + env vars; Claude Code →
   * ANTHROPIC_API_KEY; etc.). Wire-level details stay inside the
   * backend.
   */
  model: {
    /** Wire model name (e.g. `"moonshotai/Kimi-K2.6"`, `"claude-3-5-sonnet"`). */
    name: string;
    apiKey: string;
    /** OpenAI-compat base URL; absent → backend uses its tool default. */
    baseUrl?: string;
  };
  /**
   * Files the backend MUST force into the tool's context window
   * before generating. Originated as Aider's `--read` flag use
   * case (TR_032 — prose "please read PLAN.md" was being ignored
   * by Aider's LLM); other backends translate to their equivalent
   * (Claude Code: `@<path>` references; Cursor: file-pin pre-load).
   * Paths are workDir-relative; the backend filters non-existent
   * paths defensively (the planner may cite a path the phase
   * itself is about to create).
   */
  readFiles: string[];
  /**
   * Verification commands the backend should run AFTER each edit
   * before declaring success. Closes the failure mode where a
   * code-agent reports complete but the build/tests fail at CI
   * time (the user-surfaced concern that motivated this refactor).
   *
   * The backend decides HOW to express each command to its tool:
   *   - Aider:       `--test-cmd` flag + `--auto-test` (lint
   *                  is `--lint-cmd` per-language + `--auto-lint`).
   *   - Claude Code: its built-in test-runner mode.
   *   - Cursor CLI:  its post-edit hook.
   *
   * Missing fields → the corresponding step is skipped (e.g. a
   * Python project may have no separate build step). The platform
   * RESOLVES these from `HARNESS.codeGeneration.verification`
   * (explicit operator override) falling back to stack-derived
   * defaults (`stack: {language, packageManager, testFramework}`).
   * The backend never reads HARNESS directly.
   */
  verification?: {
    /** Build/compile (e.g. `"npm run build"`, `"tsc --noEmit"`, `"go build ./..."`). */
    buildCmd?: string;
    /** Test suite (e.g. `"npm test"`, `"pnpm test"`, `"pytest"`, `"go test ./..."`). */
    testCmd?: string;
    /** Lint (most tools auto-lint by default; override here if needed). */
    lintCmd?: string;
  };
  /**
   * Per-call wall-clock cap. The backend honours it; absent → backend
   * picks a sensible tool-specific default. Long enough that a
   * verification loop (LLM → write → build → fail → retry → pass)
   * fits.
   */
  timeoutMs?: number;
  /**
   * Correlation ID for log threading. Backends MUST tag their own
   * subprocess logs with it so operators can correlate across the
   * platform's structured logs and the tool's stdout.
   */
  correlationId: string;
}

/**
 * What a backend returns from one generation pass. Neutral across
 * tools — the platform reads `success` to decide pass/fail and
 * uses `output` as the human-readable narrative shown in the
 * dashboard's agent-execution log.
 */
export interface CodeAgentResult {
  /** True when the underlying tool exited 0 (or its equivalent). */
  success: boolean;
  /**
   * Narrative the platform persists as the
   * `agent_execution_logs.llm_response` for the code-agent row.
   * Operators see this verbatim in the dashboard's accordion.
   */
  output: string;
  /** Error output (stderr) populated on failure. Empty on success. */
  error: string;
  /** Raw exit code from the tool. 0 on success per convention. */
  exitCode: number;
  /** Wall-clock duration the backend spent driving its tool. */
  durationMs: number;
  /** True when the backend hit its `context.timeoutMs` (or default). */
  timedOut: boolean;
}

/**
 * The interface every code-generation backend implements. A backend
 * is a stateless adapter; `run` MUST NOT throw (the caller can't tell
 * a backend-internal exception from a tool failure). Tool failures
 * surface via `success: false` + populated `error`/`exitCode`.
 *
 * Backends do NOT see HARNESS, agents.yaml, the BullMQ message, or
 * any other platform-internal type. Everything they need is in
 * `CodeAgentContext`. This keeps the boundary auditable and makes
 * the backend usable in isolation (unit-tested against a synthetic
 * context, called from a CLI demo, etc.).
 */
export interface CodeAgentBackend {
  /**
   * Backend identifier — matches the value an operator sets in
   * `HARNESS.codeGeneration.backend`. Used by the factory to resolve
   * the implementation; surfaced in logs so operators can see which
   * backend ran which cycle.
   */
  readonly name: string;
  /** Drive a single code-generation pass. NEVER throws. */
  run(context: CodeAgentContext): Promise<CodeAgentResult>;
}
