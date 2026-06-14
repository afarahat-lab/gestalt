/**
 * Specialist contract shapes (TR_051 / ADR-056 Phase 1).
 *
 * Each specialist returns its slice of the architecture. The chief
 * receives all three slices and produces the final
 * `FeatureArchitecture` — the same shape the planning orchestrator
 * already persists into `features.architecture`. Slot-naming mirrors
 * `FeatureArchitecture` so the chief can merge by structural reuse
 * rather than translating every field.
 *
 * These shapes are the LLM contract for each specialist. The chief
 * sees them serialized as JSON in its prompt; the specialists see
 * them as JSON output schemas at the end of their prompts.
 */

export interface DomainDesign {
  /** Domain entities the feature introduces or extends. */
  domainEntities: Array<{
    name: string;
    attributes: string[];
    purpose: string;
    /**
     * Lifecycle states this entity moves through during the feature.
     * Empty array when the entity has no lifecycle (e.g. a value
     * object). Each state name should match the project's
     * documented conventions.
     */
    lifecycleStates: string[];
  }>;
  /**
   * Free-form rules describing business logic that crosses entity
   * boundaries (e.g. "approving a leave request decrements the
   * employee's balance for that leave type").
   */
  businessRules: string[];
  /**
   * Markdown the chief should fold into `architectureMdUpdate`
   * to document new entities / states. Truncated to 1500 chars.
   */
  domainNotes: string;
}

export interface DataDesign {
  /**
   * One CREATE TABLE statement per persistent entity. Required
   * whenever the declared stack includes a relational database
   * (TR_049 rule — categorical).
   */
  sqlSchemas: string[];
  /**
   * Repository interfaces with their concrete implementations.
   * TR_038 closed the original "interface without concrete impl"
   * gap; the data architect carries that constraint forward.
   */
  repositories: Array<{
    interfaceName: string;
    concreteName: string;
    methods: string[];
    /** Stack-specific backing implementation (e.g. `pg` Pool). */
    backing: string;
  }>;
  /**
   * Markdown the chief should fold into `architectureMdUpdate`
   * to document persistence concerns. Truncated to 1500 chars.
   */
  dataNotes: string;
}

export interface AppDesign {
  /**
   * Modules introduced or extended by the feature. Path is relative
   * to the project root.
   */
  modules: Array<{
    name: string;
    path: string;
    owns: string[];
  }>;
  /**
   * Service interfaces exposed by the application layer. Each entry
   * has the symbol name, the path it lives at, and the method
   * signatures (free-text, language-agnostic).
   */
  services: Array<{
    name: string;
    path: string;
    methods: string[];
  }>;
  /**
   * Directed module dependencies. `from` depends on `to`. Used by
   * the chief to detect circular dependencies before producing the
   * final architecture.
   */
  dependencyMap: Array<{ from: string; to: string }>;
  /**
   * Recommended phase decomposition. The chief may reshape this
   * list; the planner-agent reads the chief's final version.
   */
  recommendedPhases: Array<{
    title: string;
    rationale: string;
    estimatedFiles: number;
  }>;
  /**
   * Markdown the chief should fold into `architectureMdUpdate`
   * to document the application layer. Truncated to 1500 chars.
   */
  appNotes: string;
}
