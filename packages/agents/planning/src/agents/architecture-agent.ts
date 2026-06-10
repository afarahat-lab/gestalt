/**
 * architecture-agent — designs the high-level feature architecture and
 * the per-phase technical brief. Two entry points:
 *
 *   - `designFeature()`  — produces the feature-level architecture
 *     (domain entities, modules, recommended phase sequence). Called
 *     once per feature, before the planner-agent.
 *
 *   - `designPhase()`    — produces the focused per-phase architecture
 *     (exact interfaces, import paths, success criteria). Called
 *     before EACH phase is submitted, when HARNESS.json's
 *     `planner.architectureReviewPerPhase` is true.
 *
 * Reads its persona / extensions / LLM tuning from agents.yaml via the
 * platform's standard `loadAgentConfig` loader, exactly like every
 * other LLM agent in the platform. All guidance text the LLM reads
 * comes from agents.yaml + `HARNESS.json.agentConfig['architecture-agent']`.
 * Only the JSON response schema is hardcoded here.
 */

import {
  BaseLLMAgent, loadAgentConfig, extractJsonObject, createContextLogger,
} from '@gestalt/core';
import type { HarnessConfig, FeatureRecord, FeaturePhaseRecord } from '@gestalt/core';
import {
  buildFeatureArchitecturePrompt, buildPhaseArchitecturePrompt,
  buildArchitectureReviewPrompt, buildPhaseArchitectureReviewPrompt,
} from '../prompts/architecture-prompt';
import type { FeatureArchitecture, PhaseArchitecture } from '../types';

const log = createContextLogger({ module: 'architecture-agent' });

export class ArchitectureAgent extends BaseLLMAgent {
  constructor() { super('architecture-agent'); }

  protected buildPrompt(): string {
    throw new Error('ArchitectureAgent.buildPrompt() is not used — see designFeature / designPhase');
  }
  protected parseResponse(): unknown {
    throw new Error('ArchitectureAgent.parseResponse() is not used');
  }

  /**
   * Produce the high-level architecture for a feature. The result is
   * persisted into `features.architecture` and seeds the planner.
   */
  async designFeature(
    feature: FeatureRecord,
    existingArchitectureMd: string,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<FeatureArchitecture> {
    this.lastTokensUsed = 0;
    // TR_035 / ADR-057 Layer 3+5 read knobs from harnessConfig.
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'architecture-agent');
    const prompt = this.addJsonResponseGuard(
      buildFeatureArchitecturePrompt(
        feature, existingArchitectureMd, agentCfg, harnessConfig,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parseFeatureArchitecture(raw, correlationId);
  }

  /**
   * TR_038 — STOPGAP (ADR-056). Re-reads the architecture-agent's
   * own draft and asks the SAME agent to check completeness,
   * consistency, ambiguity, and feasibility against the declared
   * project stack. Returns the corrected JSON when the review
   * fires; returns the original draft unchanged on ANY failure
   * (parse error, LLM call error) so the pipeline is never
   * blocked on a review-only error.
   *
   * This single-agent self-review will be replaced by the
   * LangGraph architecture crew (domain + data + application
   * architects deliberating in parallel with a chief-architect
   * supervisor) in Phase 1 of the migration. Delete this method
   * + `buildArchitectureReviewPrompt` + the orchestrator call
   * site when the crew lands.
   */
  async reviewDesign(
    draft: FeatureArchitecture,
    feature: FeatureRecord,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<FeatureArchitecture> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    let agentCfg;
    try {
      agentCfg = await loadAgentConfig(projectRoot, 'architecture-agent');
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId },
        'architecture-agent reviewDesign could not load agent config — returning original draft',
      );
      return draft;
    }
    const prompt = this.addJsonResponseGuard(
      buildArchitectureReviewPrompt(draft, feature, agentCfg, harnessConfig),
    );
    let raw: string;
    try {
      raw = await this.callLLM(prompt, agentCfg, correlationId);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId },
        'architecture-agent reviewDesign LLM call failed — returning original draft',
      );
      return draft;
    }
    const reviewed = parseFeatureArchitecture(raw, correlationId);
    // `parseFeatureArchitecture` never throws — it returns an
    // empty-fields fallback object on JSON-parse failure. Detect
    // that case explicitly and return the original draft instead
    // of an empty review (the empty-fallback would discard the
    // legitimate work the design pass just produced).
    if (reviewed.domainEntities.length === 0 && reviewed.modules.length === 0) {
      log.warn(
        { correlationId },
        'architecture-agent reviewDesign parsed to empty — returning original draft',
      );
      return draft;
    }
    log.info(
      {
        correlationId,
        beforeEntities: draft.domainEntities.length,
        afterEntities: reviewed.domainEntities.length,
        beforeModules: draft.modules.length,
        afterModules: reviewed.modules.length,
      },
      'architecture-agent reviewDesign complete',
    );
    return reviewed;
  }

  /**
   * Produce the per-phase architecture for a single phase. Called
   * before the planner finalises the phase's scope so the phase
   * inherits exact interface names + import paths.
   */
  async designPhase(
    feature: FeatureRecord,
    phaseTitle: string,
    phaseRationale: string,
    featureArchitecture: string,
    priorPhases: FeaturePhaseRecord[],
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<PhaseArchitecture> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'architecture-agent');
    const prompt = this.addJsonResponseGuard(
      buildPhaseArchitecturePrompt(
        feature, phaseTitle, phaseRationale, featureArchitecture,
        priorPhases, agentCfg, harnessConfig,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parsePhaseArchitecture(raw, correlationId);
  }

  /**
   * TR_042 — STOPGAP (ADR-056). Mirrors `reviewDesign` for the
   * per-phase architecture. The feature-level review in TR_041
   * cleaned the feature architecture but the per-phase pass kept
   * leaking framework references; TR_042's verification of the
   * per-phase pass surfaced both the framework drift and a
   * scope-vs-architecture file-list mismatch. This review pass
   * applies the SAME treatment that worked at the feature level:
   * a stack-compliance block rendered FIRST in the prompt + a
   * five-point review checklist.
   *
   * Returns the original draft on ANY failure path (loadAgentConfig
   * throw, callLLM throw, parse-to-empty) so the pipeline is never
   * blocked on a review-only error. Same safety semantics as
   * `reviewDesign`.
   *
   * This single-agent self-review will be replaced by the
   * LangGraph architecture crew per-phase reviewer in Phase 1 of
   * the migration. Delete this method +
   * `buildPhaseArchitectureReviewPrompt` + the orchestrator call
   * site when the crew lands.
   */
  async reviewPhaseDesign(
    draft: PhaseArchitecture,
    phase: FeaturePhaseRecord,
    feature: FeatureRecord,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<PhaseArchitecture> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    let agentCfg;
    try {
      agentCfg = await loadAgentConfig(projectRoot, 'architecture-agent');
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId },
        'architecture-agent reviewPhaseDesign could not load agent config — returning original draft',
      );
      return draft;
    }
    const prompt = this.addJsonResponseGuard(
      buildPhaseArchitectureReviewPrompt(draft, phase, feature, agentCfg, harnessConfig),
    );
    let raw: string;
    try {
      raw = await this.callLLM(prompt, agentCfg, correlationId);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId },
        'architecture-agent reviewPhaseDesign LLM call failed — returning original draft',
      );
      return draft;
    }
    const reviewed = parsePhaseArchitecture(raw, correlationId);
    // `parsePhaseArchitecture` never throws — it returns an
    // empty-fields fallback object on JSON-parse failure. Detect
    // that case explicitly and return the original draft instead
    // of an empty review (the empty-fallback would discard the
    // legitimate work the design pass just produced).
    if (reviewed.interfaces.length === 0 && reviewed.successCriteria.length === 0) {
      log.warn(
        { correlationId, phaseId: phase.id },
        'architecture-agent reviewPhaseDesign parsed to empty — returning original draft',
      );
      return draft;
    }
    log.info(
      {
        correlationId,
        phaseId: phase.id,
        phaseIndex: phase.phaseIndex,
        beforeInterfaces: draft.interfaces.length,
        afterInterfaces: reviewed.interfaces.length,
        beforeImports: draft.importStatements.length,
        afterImports: reviewed.importStatements.length,
        beforeCriteria: draft.successCriteria.length,
        afterCriteria: reviewed.successCriteria.length,
      },
      'architecture-agent reviewPhaseDesign complete',
    );
    return reviewed;
  }
}

function parseFeatureArchitecture(raw: string, correlationId: string): FeatureArchitecture {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<FeatureArchitecture>;
    return {
      domainEntities: Array.isArray(parsed.domainEntities) ? parsed.domainEntities : [],
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      dependencyMap: Array.isArray(parsed.dependencyMap) ? parsed.dependencyMap : [],
      recommendedPhases: Array.isArray(parsed.recommendedPhases) ? parsed.recommendedPhases : [],
      architectureMdUpdate: typeof parsed.architectureMdUpdate === 'string'
        ? parsed.architectureMdUpdate
        : '',
    };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'architecture-agent feature response could not be parsed — using empty design',
    );
    return {
      domainEntities: [], modules: [], dependencyMap: [],
      recommendedPhases: [], architectureMdUpdate: '',
    };
  }
}

function parsePhaseArchitecture(raw: string, correlationId: string): PhaseArchitecture {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<PhaseArchitecture>;
    const result: PhaseArchitecture = {
      interfaces: Array.isArray(parsed.interfaces) ? parsed.interfaces.filter((s): s is string => typeof s === 'string') : [],
      importStatements: Array.isArray(parsed.importStatements) ? parsed.importStatements.filter((s): s is string => typeof s === 'string') : [],
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.filter((s): s is string => typeof s === 'string') : [],
    };
    if (typeof parsed.sqlSchema === 'string' && parsed.sqlSchema.length > 0) {
      result.sqlSchema = parsed.sqlSchema;
    }
    return result;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'architecture-agent phase response could not be parsed — using empty design',
    );
    return { interfaces: [], importStatements: [], successCriteria: [] };
  }
}
