/**
 * Planning-layer-specific types.
 *
 * These describe the shapes the three planning agents produce / consume.
 * The platform-level types (`FeatureRecord`, `FeaturePhaseRecord`,
 * `FeaturePlanLogRecord`, `FeatureStatus`, `PhaseStatus`) live in
 * `@gestalt/core` because the repository surface needs them.
 *
 * The JSON shapes here are the LLM contract — what each agent must
 * return. They are the only platform-mechanic content in this package's
 * prompt builders; all guidance text (rules / scoping examples /
 * evaluation criteria) flows in from HARNESS.json + agents.yaml.
 */

/**
 * Architecture-agent's high-level feature design. Produced once per
 * feature, before any planning. Persisted into
 * `features.architecture` and surfaced in subsequent phase prompts.
 */
export interface FeatureArchitecture {
  domainEntities: Array<{
    name: string;
    attributes: string[];
    purpose: string;
  }>;
  modules: Array<{
    name: string;
    path: string;
    owns: string[];
  }>;
  dependencyMap: Array<{
    from: string;
    to: string;
  }>;
  recommendedPhases: Array<{
    title: string;
    rationale: string;
    estimatedFiles: number;
  }>;
  /** Markdown to append to `docs/ARCHITECTURE.md`. */
  architectureMdUpdate: string;
}

/**
 * Architecture-agent's per-phase design — the focused TypeScript /
 * Python / etc. interface signatures + import paths the phase
 * should respect. Persisted into `feature_phases.architecture`.
 */
export interface PhaseArchitecture {
  /**
   * Exact interface signatures the phase should implement. Free
   * text — the LLM picks the syntax that fits the project's
   * language. Surfaced verbatim in the planner-agent's scope.
   */
  interfaces: string[];
  /**
   * Specific import statements (with actual file paths) the phase
   * should use. Used to anchor the scope so Aider opens the right
   * files first.
   */
  importStatements: string[];
  /** Optional SQL schema for this phase. */
  sqlSchema?: string;
  /** 3-5 measurable success criteria for the phase. */
  successCriteria: string[];
}

/**
 * Planner-agent's decomposition. One entry per phase, ordered by
 * dependency. Each entry becomes a row in `feature_phases`.
 */
export interface FeaturePlan {
  phases: Array<{
    title: string;
    scope: string;
    dependencies: string[];
    architecture?: string;
  }>;
}

/**
 * Phase-evaluator-agent's verdict + adjustments. Persisted into
 * `feature_phases.result`.
 */
export interface PhaseEvaluation {
  /** 'success' | 'partial' | 'escalate'. */
  verdict: 'success' | 'partial' | 'escalate';
  summary: string;
  /**
   * Adjustments to apply to remaining phases. Each entry names a
   * phase by title and supplies the patched scope / dependencies.
   */
  adjustments: Array<{
    phaseTitle: string;
    updatedScope?: string;
    updatedDependencies?: string[];
    reason: string;
  }>;
  /**
   * Files that the evaluated phase actually wrote, with their key
   * exports. Sourced from the agent's git diff + readFile pass —
   * NOT from Aider stdout (ADR-050). Rendered into PLAN.md's
   * "What has been built" section so future phases (and Aider on
   * future Aider runs) can see what concretely exists on disk.
   */
  builtFiles?: Array<{
    path: string;
    exports?: string[];
  }>;
}
