/**
 * @gestalt/core/harness
 *
 * Harness engine — manages context files for agent-first projects.
 *
 * Responsibilities:
 *   - Load and parse HARNESS.json and all context files
 *   - Validate completeness (all required files present)
 *   - Build ContextSnapshot for agent dispatch
 *   - Detect staleness (files not updated recently)
 *   - Version tracking via Git history
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { SignalType, HarnessPipelineConfig } from '../types';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'harness' });

// ─── Context file spec ────────────────────────────────────────────────────────

export const REQUIRED_CONTEXT_FILES = [
  'AGENTS.md',
  'HARNESS.json',
  'docs/ARCHITECTURE.md',
  'docs/DOMAIN.md',
  'docs/GOLDEN_PRINCIPLES.md',
  'docs/DECISIONS.md',
] as const;

/**
 * Optional context files validated when present but not required.
 *
 *   agents.yaml — Per-agent prompt + LLM configuration (Step 1 of agent
 *                 externalisation). Loaded by `loadAgentConfig` in
 *                 `@gestalt/agents-generate`. Absent → defaults apply.
 *                 Malformed → warning, defaults still apply.
 */
export const OPTIONAL_CONTEXT_FILES = ['agents.yaml'] as const;

export type RequiredContextFile = typeof REQUIRED_CONTEXT_FILES[number];

// ─── Harness config (parsed from HARNESS.json) ────────────────────────────────

/**
 * Project-defined constraint rule (HARNESS.json `constraints.rules`).
 * Surfaced verbatim in code-agent and review-agent prompts so the
 * model knows what the automated constraint-agent will flag after
 * generation. Severity hints the LLM at fix priority but is also the
 * value used to bucket the resulting CONSTRAINT_VIOLATION signal.
 */
export interface ConstraintRule {
  id: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * TEST_REPORT_005 (executeScript-evolution) — per-agent rules section
 * on HARNESS.json. Plain-English only; the LLM decides what scripts
 * to run / files to read to verify each rule.
 *
 * `verificationGuidance` (TR_021) — project-specific hints about HOW
 * to verify findings before emitting them. Examples:
 *   - "For DB access findings: run searchFiles for 'pool.query' first"
 *   - "For import findings: run tsc --noEmit before flagging"
 * Renders into the prompt as a "Verification guidance for this project"
 * block under the rules section. Supplements (does not replace) the
 * platform's mandatory evidence requirement, severity ceiling, and
 * JSON-schema enforcement which stay hardcoded in the agent .ts files.
 */
export interface HarnessAgentConfig {
  rules?: string[];
  verificationGuidance?: string[];
  /**
   * Planning layer additions (migration 024). Per-agent guidance for
   * the three planning agents:
   *
   *   - `phaseScopingRules`     → planner-agent: examples of good vs
   *     bad phase scopes
   *   - `evaluationCriteria`    → phase-evaluator-agent: when to mark
   *     success / partial / escalate
   *   - `architectureGuidance`  → architecture-agent: how to approach
   *     high-level vs per-phase design
   *
   * Same contract as `rules` + `verificationGuidance` — operators
   * customise per project without touching platform code. The platform
   * mechanics (JSON schemas, parsing, loop logic) stay in the agent
   * .ts files; the prompt content the LLM reads lives here.
   */
  phaseScopingRules?: string[];
  evaluationCriteria?: string[];
  architectureGuidance?: string[];
}

export interface HarnessConfig {
  name: string;
  version: string;
  tier: 'tier1' | 'tier2' | 'tier3';
  stack: Record<string, string>;
  adapters: {
    database: { type: string; configKey: string };
    queue: { type: string; configKey: string };
    llm: { type: string; configKey: string };
  };
  qualityGate: {
    maxRetries: number;
    blockingSignals: SignalType[];
    autoResolvableSignals: SignalType[];
    required: string[];
  };
  /**
   * Optional project-specific constraint rules. When present the
   * code/test/review prompts inline `constraints.rules` verbatim so
   * the LLM knows what the automated constraint-agent will check.
   * Absent on legacy projects — prompts fall back to the inline rules
   * baked into the agent definitions.
   */
  constraints?: {
    rules: ConstraintRule[];
  };
  /**
   * Per-agent rules section (TEST_REPORT_005 evolution). Each entry
   * carries plain-English rules the agent must enforce / consider.
   * WHAT the agent enforces is declarative project intent; HOW it
   * verifies is the LLM's decision (it has `executeScript` + the
   * existing read-only file tools to choose from).
   *
   * Example:
   *   {
   *     "constraint-agent": {
   *       "rules": [
   *         "No SQL queries outside repository classes",
   *         "All async functions must handle errors"
   *       ]
   *     }
   *   }
   *
   * Absent agents simply receive the empty section; rule injection
   * is opt-in per agent. There are NO hardcoded script commands
   * anywhere — adding `executeScript` to the agent's tool list +
   * listing rules here is the entire configuration surface.
   */
  agentConfig?: Record<string, HarnessAgentConfig>;
  identity?: Record<string, unknown>;
  /**
   * Pipeline config (ADR-033). Reads as the typed
   * `HarnessPipelineConfig` so callers can read `pipeline.autoMerge`
   * and `pipeline.mergeMethod` without `as`-casting through
   * `Record<string, unknown>`. Legacy projects with only
   * `pipeline.adapter` continue to satisfy this shape (the new fields
   * are optional).
   */
  pipeline?: HarnessPipelineConfig;
  maintenance?: Record<string, unknown>;
  /**
   * Project-level MCP server credentials (ADR-039). Referenced from
   * `agents.yaml` via `tools.mcp[].token_from: 'harness'`. Tokens
   * stored here are visible to anyone with repo read access — for
   * sensitive credentials use `token_from: env:VAR_NAME` instead.
   * See docs/reference/harness-config.md for the security model.
   */
  mcp?: {
    servers: Array<{
      name: string;
      url: string;
      token?: string;
    }>;
  };
  /**
   * Code-generation backend (TR_014). Default `'gestalt'` keeps the
   * existing code-agent + test-agent path. Setting `'aider'` makes
   * the generate-orchestrator dispatch the Aider CLI for the
   * code-agent step (Aider writes files directly to the cycle's
   * cloned work-dir; the adapter then re-reads them as artifacts so
   * the gate + deploy layers see them unchanged) and skip the
   * test-agent step (Aider produces tests inline as part of the
   * same session). Opt-in per project. Existing projects with no
   * `codeGeneration` block continue to run on the `gestalt` backend.
   */
  codeGeneration?: {
    backend: 'gestalt' | 'aider';
  };
  /**
   * Planning layer configuration (migration 024). Absent → planner
   * disabled; projects opt in by adding this block. Bounds the
   * planner-agent's output (max phases, max files per phase) so a
   * runaway LLM cannot blow through the operator's budget. When
   * `architectureReviewPerPhase` is true, architecture-agent is
   * consulted before every phase, not just at the feature level.
   */
  planner?: {
    enabled: boolean;
    maxPhasesPerFeature: number;
    maxFilesPerPhase: number;
    architectureReviewPerPhase: boolean;
    /**
     * TR_022 — max retries for a single phase before the orchestrator
     * gives up and marks the feature blocked. Default `2` when the
     * field is absent (one initial attempt + 2 retries = 3 total
     * attempts per phase). Set to `0` to restore pre-TR_022 behaviour
     * (one attempt, no retries).
     */
    maxPhaseRetries?: number;
  };
  /**
   * TR_027 / ADR-051 — CodiumAI PR-Agent integration. When the
   * project's `pipeline.adapter === 'github-actions'` AND
   * `prAgent.enabled === true`, pipeline-agent reads PR-Agent's
   * review verdict from the PR before dispatching the gate, and
   * the gate skips the legacy `review-agent` step. Self-healing
   * handles `changes-requested` verdicts via the existing
   * fix-intent action vocabulary.
   *
   * `.pr_agent.toml` is generated at `gestalt init` time from
   * `agentConfig['review-agent'].rules` +
   * `agentConfig['constraint-agent'].rules` and committed to the
   * project repo. Operators regenerate it via
   * `gestalt project config push-pr-agent-config` after editing
   * HARNESS.json.
   *
   * `pendingTimeoutSeconds` bounds the deploy-orchestrator's
   * "PR-Agent review hasn't posted yet" re-poll loop. Default 90s.
   * `blockOnChangesRequested` defaults to true; setting it false
   * lets the cycle proceed to gate even on a `changes-requested`
   * verdict (useful for advisory PR-Agent installs).
   */
  prAgent?: {
    enabled: boolean;
    blockOnChangesRequested?: boolean;
    pendingTimeoutSeconds?: number;
  };
  /**
   * TR_035 / ADR-057 — Dynamic token budget management knobs.
   * Absent → all five layers run with the defaults baked into
   * `BaseLLMAgent` (threshold 6000 tokens, retry multiplier 2.0,
   * both feature flags on). Operators tune per-project.
   */
  tokenManagement?: TokenManagementConfig;
}

/**
 * TR_035 / ADR-057 — knobs that gate the five token-management
 * layers in `BaseLLMAgent`. Layer 1 (model-aware defaults) +
 * Layer 4 (JSON guard) + Layer 5 (truncation retry) always run;
 * only Layers 2 and 3 are operator-disable-able because they
 * change prompt text the operator may want to preserve byte-for-
 * byte.
 */
export interface TokenManagementConfig {
  /** Estimated input tokens above which Layer 3 scope reduction
   *  kicks in. Default 6000. */
  promptCompressionThreshold?: number;
  /** Multiplier applied to `max_tokens` on each Layer 5 retry.
   *  Default 2.0. Capped per call by the model's hard limit. */
  maxRetryBudgetMultiplier?: number;
  /** Layer 2 toggle. Default true. When false the configured
   *  `max_tokens` is used verbatim. */
  enableDynamicBudget?: boolean;
  /** Layer 3 toggle. Default true. When false the prompt is sent
   *  unmodified regardless of size. */
  enableScopeReduction?: boolean;
}

// ─── Context snapshot (what agents receive) ───────────────────────────────────

export interface ContextSnapshot {
  projectRoot: string;
  harness: HarnessConfig;
  agentsMd: string;
  architectureMd: string;
  domainMd: string;
  goldenPrinciplesMd: string;
  relevantDecisions: string;       // filtered subset of DECISIONS.md
  snapshotAt: Date;
}

// ─── Validation result ────────────────────────────────────────────────────────

export interface HarnessValidationResult {
  valid: boolean;
  missingFiles: string[];
  parseErrors: string[];
  warnings: string[];
}

// ─── Harness engine ───────────────────────────────────────────────────────────

export class HarnessEngine {
  constructor(private readonly projectRoot: string) {}

  /**
   * Loads and validates the project harness.
   * Returns a validation result with all issues found.
   */
  async validate(): Promise<HarnessValidationResult> {
    const missingFiles: string[] = [];
    const parseErrors: string[] = [];
    const warnings: string[] = [];

    // Check all required context files exist
    for (const file of REQUIRED_CONTEXT_FILES) {
      const filePath = join(this.projectRoot, file);
      try {
        await access(filePath);
      } catch {
        missingFiles.push(file);
      }
    }

    // Try to parse HARNESS.json
    if (!missingFiles.includes('HARNESS.json')) {
      try {
        await this.loadHarnessConfig();
      } catch (e) {
        parseErrors.push(`HARNESS.json parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // agents.yaml — optional. If present, parse it and warn (not fail)
    // when it's malformed or missing the `agents` key. The per-cycle
    // loader (`@gestalt/agents-generate/loadAgentConfig`) falls back to
    // defaults independently, so a bad agents.yaml never breaks a
    // cycle; the warning surfaces in `gestalt status` and the
    // dashboard's validation panel.
    try {
      const yamlRaw = await readFile(join(this.projectRoot, 'agents.yaml'), 'utf8');
      try {
        const parsed = parseYaml(yamlRaw) as { agents?: unknown };
        if (!parsed || typeof parsed !== 'object' || !parsed.agents) {
          warnings.push('agents.yaml present but has no "agents" key — defaults will be used');
        }
      } catch (e) {
        warnings.push(`agents.yaml parse error: ${e instanceof Error ? e.message : String(e)} — defaults will be used`);
      }
    } catch {
      // agents.yaml absent — not a warning, this is the common case
      // for older projects.
    }

    const valid = missingFiles.length === 0 && parseErrors.length === 0;
    return { valid, missingFiles, parseErrors, warnings };
  }

  /**
   * Builds a ContextSnapshot for agent dispatch.
   * Reads all context files from disk.
   * Call once per intent cycle — agents receive the snapshot, not file paths.
   */
  async buildSnapshot(correlationId?: string): Promise<ContextSnapshot> {
    const childLog = createContextLogger({ module: 'harness', correlationId });
    childLog.debug('Building context snapshot');

    const [harness, agentsMd, architectureMd, domainMd, goldenPrinciplesMd, decisionsMd] =
      await Promise.all([
        this.loadHarnessConfig(),
        this.readFile('AGENTS.md'),
        this.readFile('docs/ARCHITECTURE.md'),
        this.readFile('docs/DOMAIN.md'),
        this.readFile('docs/GOLDEN_PRINCIPLES.md'),
        this.readFile('docs/DECISIONS.md'),
      ]);

    childLog.debug('Context snapshot built');

    return {
      projectRoot: this.projectRoot,
      harness,
      agentsMd,
      architectureMd,
      domainMd,
      goldenPrinciplesMd,
      relevantDecisions: decisionsMd,  // full for now; filtered by domain in Phase 2
      snapshotAt: new Date(),
    };
  }

  /**
   * Loads and parses HARNESS.json.
   */
  async loadHarnessConfig(): Promise<HarnessConfig> {
    const raw = await this.readFile('HARNESS.json');
    return JSON.parse(raw) as HarnessConfig;
  }

  /**
   * Checks if a context file exists and returns its content.
   * Emits a CONTEXT_GAP signal description if missing.
   */
  async readContextFile(relativePath: string): Promise<{ content: string; missing: boolean }> {
    try {
      const content = await this.readFile(relativePath);
      return { content, missing: false };
    } catch {
      log.warn({ file: relativePath }, 'Context file missing');
      return { content: '', missing: true };
    }
  }

  /**
   * Writes a context file update.
   * Used by context-agent and drift-agent for direct fixes.
   */
  async writeContextFile(relativePath: string, content: string): Promise<void> {
    const { writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    const filePath = join(this.projectRoot, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    log.info({ file: relativePath }, 'Context file updated');
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async readFile(relativePath: string): Promise<string> {
    return readFile(join(this.projectRoot, relativePath), 'utf8');
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a HarnessEngine for the given project root.
 */
export function createHarnessEngine(projectRoot: string): HarnessEngine {
  return new HarnessEngine(projectRoot);
}
