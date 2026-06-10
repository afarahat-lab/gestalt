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
