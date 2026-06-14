/**
 * Architecture-crew agent classes (TR_051 / ADR-056 Phase 1).
 *
 * Each specialist extends `BaseLLMAgent` so the platform's standard
 * machinery applies for free:
 *   - `loadAgentConfig(projectRoot, role)` resolves agents.yaml
 *   - five-layer token management (ADR-057) on every LLM call
 *   - `lastTokensUsed` accumulates so the graph can sum across nodes
 *   - per-call telemetry persisted via `agent_execution_logs`
 *
 * The classes are thin wrappers — orchestration of the four agents
 * happens in the LangGraph nodes (see `nodes.ts`).
 */

import {
  BaseLLMAgent, loadAgentConfig, extractJsonObject, createContextLogger,
} from '@gestalt/core';
import type { FeatureRecord, HarnessConfig } from '@gestalt/core';
import {
  buildDomainArchitectPrompt, buildDataArchitectPrompt,
  buildAppArchitectPrompt, buildChiefArchitectPrompt,
} from './prompts';
import type { DomainDesign, DataDesign, AppDesign } from './types';
import type { FeatureArchitecture } from '../../types';

const log = createContextLogger({ module: 'architecture-crew' });

// ─── Domain architect ────────────────────────────────────────────────

export class DomainArchitectAgent extends BaseLLMAgent {
  constructor() { super('domain-architect-agent'); }

  protected buildPrompt(): string {
    throw new Error('DomainArchitectAgent.buildPrompt() is not used — call design()');
  }
  protected parseResponse(): unknown {
    throw new Error('DomainArchitectAgent.parseResponse() is not used');
  }

  async design(
    feature: FeatureRecord,
    existingArchitectureMd: string,
    goldenPrinciplesMd: string,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<DomainDesign> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'domain-architect-agent');
    const prompt = this.addJsonResponseGuard(
      buildDomainArchitectPrompt(
        feature, existingArchitectureMd, goldenPrinciplesMd, agentCfg, harnessConfig,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parseDomainDesign(raw, correlationId);
  }
}

// ─── Data architect ──────────────────────────────────────────────────

export class DataArchitectAgent extends BaseLLMAgent {
  constructor() { super('data-architect-agent'); }

  protected buildPrompt(): string {
    throw new Error('DataArchitectAgent.buildPrompt() is not used — call design()');
  }
  protected parseResponse(): unknown {
    throw new Error('DataArchitectAgent.parseResponse() is not used');
  }

  async design(
    feature: FeatureRecord,
    existingArchitectureMd: string,
    goldenPrinciplesMd: string,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<DataDesign> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'data-architect-agent');
    const prompt = this.addJsonResponseGuard(
      buildDataArchitectPrompt(
        feature, existingArchitectureMd, goldenPrinciplesMd, agentCfg, harnessConfig,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parseDataDesign(raw, correlationId);
  }
}

// ─── Application architect ───────────────────────────────────────────

export class AppArchitectAgent extends BaseLLMAgent {
  constructor() { super('app-architect-agent'); }

  protected buildPrompt(): string {
    throw new Error('AppArchitectAgent.buildPrompt() is not used — call design()');
  }
  protected parseResponse(): unknown {
    throw new Error('AppArchitectAgent.parseResponse() is not used');
  }

  async design(
    feature: FeatureRecord,
    existingArchitectureMd: string,
    goldenPrinciplesMd: string,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<AppDesign> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'app-architect-agent');
    const prompt = this.addJsonResponseGuard(
      buildAppArchitectPrompt(
        feature, existingArchitectureMd, goldenPrinciplesMd, agentCfg, harnessConfig,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parseAppDesign(raw, correlationId);
  }
}

// ─── Chief architect (supervisor) ────────────────────────────────────

export class ChiefArchitectAgent extends BaseLLMAgent {
  constructor() { super('chief-architect-agent'); }

  protected buildPrompt(): string {
    throw new Error('ChiefArchitectAgent.buildPrompt() is not used — call review()');
  }
  protected parseResponse(): unknown {
    throw new Error('ChiefArchitectAgent.parseResponse() is not used');
  }

  async review(
    feature: FeatureRecord,
    domainDesign: DomainDesign | null,
    dataDesign: DataDesign | null,
    appDesign: AppDesign | null,
    existingArchitectureMd: string,
    goldenPrinciplesMd: string,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
    specialistErrors: string[],
  ): Promise<FeatureArchitecture> {
    this.lastTokensUsed = 0;
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'chief-architect-agent');
    const prompt = this.addJsonResponseGuard(
      buildChiefArchitectPrompt(
        feature, domainDesign, dataDesign, appDesign,
        existingArchitectureMd, goldenPrinciplesMd,
        agentCfg, harnessConfig, specialistErrors,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parseFeatureArchitecture(raw, correlationId);
  }
}

// ─── Parsers (mirror the patterns in architecture-agent.ts) ──────────

/**
 * TR_053 NRB-2 — specialist parsers used to swallow `JSON.parse`
 * failure and return an empty `Design` fallback. The chief reconciled
 * around the empty slice but the graph state's `errors[]` stayed
 * empty, so operators had no signal that a specialist had failed.
 *
 * The parsers now THROW on two distinct failure modes:
 *   - `parse-failure`     — `JSON.parse` rejected the response
 *   - `parsed-to-empty`   — JSON valid, but every field is empty
 *
 * Each architect node (`nodes.ts`) catches and emits a structured
 * sentinel into `state.errors[]` so the chief prompt and the
 * dashboard both see which slice dropped.
 */
class SpecialistResponseError extends Error {
  constructor(
    public readonly kind: 'parse-failure' | 'parsed-to-empty',
    public readonly role: 'domain' | 'data' | 'app',
    public readonly responseLength: number,
    public readonly cause?: Error,
  ) {
    super(
      `${role}-architect: ${kind} (responseLength=${responseLength})${
        cause ? `: ${cause.message}` : ''
      }`,
    );
    this.name = 'SpecialistResponseError';
  }
}

function parseDomainDesign(raw: string, correlationId: string): DomainDesign {
  let parsed: Partial<DomainDesign>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Partial<DomainDesign>;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId, responseLength: raw.length },
      'domain-architect response could not be parsed — propagating to state.errors',
    );
    throw new SpecialistResponseError(
      'parse-failure', 'domain', raw.length, err instanceof Error ? err : undefined,
    );
  }
  const design: DomainDesign = {
    domainEntities: Array.isArray(parsed.domainEntities)
      ? parsed.domainEntities.map((e) => ({
          name: typeof e?.name === 'string' ? e.name : '',
          attributes: Array.isArray(e?.attributes)
            ? e.attributes.filter((s): s is string => typeof s === 'string')
            : [],
          purpose: typeof e?.purpose === 'string' ? e.purpose : '',
          lifecycleStates: Array.isArray(e?.lifecycleStates)
            ? e.lifecycleStates.filter((s): s is string => typeof s === 'string')
            : [],
        }))
      : [],
    businessRules: Array.isArray(parsed.businessRules)
      ? parsed.businessRules.filter((s): s is string => typeof s === 'string')
      : [],
    domainNotes: typeof parsed.domainNotes === 'string' ? parsed.domainNotes : '',
  };
  if (design.domainEntities.length === 0 && design.businessRules.length === 0) {
    log.warn(
      { correlationId, responseLength: raw.length },
      'domain-architect parsed to empty — propagating to state.errors',
    );
    throw new SpecialistResponseError('parsed-to-empty', 'domain', raw.length);
  }
  return design;
}

function parseDataDesign(raw: string, correlationId: string): DataDesign {
  let parsed: Partial<DataDesign>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Partial<DataDesign>;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId, responseLength: raw.length },
      'data-architect response could not be parsed — propagating to state.errors',
    );
    throw new SpecialistResponseError(
      'parse-failure', 'data', raw.length, err instanceof Error ? err : undefined,
    );
  }
  const design: DataDesign = {
    sqlSchemas: Array.isArray(parsed.sqlSchemas)
      ? parsed.sqlSchemas.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [],
    repositories: Array.isArray(parsed.repositories)
      ? parsed.repositories.map((r) => ({
          interfaceName: typeof r?.interfaceName === 'string' ? r.interfaceName : '',
          concreteName: typeof r?.concreteName === 'string' ? r.concreteName : '',
          methods: Array.isArray(r?.methods)
            ? r.methods.filter((s): s is string => typeof s === 'string')
            : [],
          backing: typeof r?.backing === 'string' ? r.backing : '',
        }))
      : [],
    dataNotes: typeof parsed.dataNotes === 'string' ? parsed.dataNotes : '',
  };
  if (design.sqlSchemas.length === 0 && design.repositories.length === 0) {
    log.warn(
      { correlationId, responseLength: raw.length },
      'data-architect parsed to empty — propagating to state.errors',
    );
    throw new SpecialistResponseError('parsed-to-empty', 'data', raw.length);
  }
  return design;
}

function parseAppDesign(raw: string, correlationId: string): AppDesign {
  let parsed: Partial<AppDesign>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Partial<AppDesign>;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId, responseLength: raw.length },
      'app-architect response could not be parsed — propagating to state.errors',
    );
    throw new SpecialistResponseError(
      'parse-failure', 'app', raw.length, err instanceof Error ? err : undefined,
    );
  }
  const design: AppDesign = {
    modules: Array.isArray(parsed.modules)
      ? parsed.modules.map((m) => ({
          name: typeof m?.name === 'string' ? m.name : '',
          path: typeof m?.path === 'string' ? m.path : '',
          owns: Array.isArray(m?.owns) ? m.owns.filter((s): s is string => typeof s === 'string') : [],
        }))
      : [],
    services: Array.isArray(parsed.services)
      ? parsed.services.map((s) => ({
          name: typeof s?.name === 'string' ? s.name : '',
          path: typeof s?.path === 'string' ? s.path : '',
          methods: Array.isArray(s?.methods)
            ? s.methods.filter((m): m is string => typeof m === 'string')
            : [],
        }))
      : [],
    dependencyMap: Array.isArray(parsed.dependencyMap)
      ? parsed.dependencyMap.map((d) => ({
          from: typeof d?.from === 'string' ? d.from : '',
          to: typeof d?.to === 'string' ? d.to : '',
        }))
      : [],
    recommendedPhases: Array.isArray(parsed.recommendedPhases)
      ? parsed.recommendedPhases.map((p) => ({
          title: typeof p?.title === 'string' ? p.title : '',
          rationale: typeof p?.rationale === 'string' ? p.rationale : '',
          estimatedFiles: typeof p?.estimatedFiles === 'number' ? p.estimatedFiles : 0,
        }))
      : [],
    appNotes: typeof parsed.appNotes === 'string' ? parsed.appNotes : '',
  };
  if (
    design.modules.length === 0 &&
    design.services.length === 0 &&
    design.recommendedPhases.length === 0
  ) {
    log.warn(
      { correlationId, responseLength: raw.length },
      'app-architect parsed to empty — propagating to state.errors',
    );
    throw new SpecialistResponseError('parsed-to-empty', 'app', raw.length);
  }
  return design;
}

/**
 * Parse the chief's reconciled output into the canonical
 * `FeatureArchitecture` shape the planning orchestrator already
 * persists. Mirrors the parser in `architecture-agent.ts` so existing
 * downstream consumers (planner-agent, intent-agent context, dashboard)
 * read the same fields they always have.
 *
 * Also extracts `sqlSchemas` into the field on
 * `FeatureArchitecture.sqlSchemas` if the chief emitted one — TR_048's
 * canonical-schema-reuse machinery prefers the explicit field over
 * regex-matching against `architectureMdUpdate`.
 */
function parseFeatureArchitecture(raw: string, correlationId: string): FeatureArchitecture {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<FeatureArchitecture> & {
      sqlSchemas?: unknown;
    };
    const out: FeatureArchitecture = {
      domainEntities: Array.isArray(parsed.domainEntities) ? parsed.domainEntities : [],
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      dependencyMap: Array.isArray(parsed.dependencyMap) ? parsed.dependencyMap : [],
      recommendedPhases: Array.isArray(parsed.recommendedPhases) ? parsed.recommendedPhases : [],
      architectureMdUpdate: typeof parsed.architectureMdUpdate === 'string'
        ? parsed.architectureMdUpdate
        : '',
    };
    // The chief may emit an explicit `sqlSchemas[]` field. The
    // `FeatureArchitecture` interface doesn't carry that field
    // statically yet (TR_048 reads it via duck-typing in
    // `extractCanonicalSqlSchemas`), so attach it on the JSON
    // serialization path by widening the local object.
    if (Array.isArray(parsed.sqlSchemas)) {
      const schemas = (parsed.sqlSchemas as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      );
      if (schemas.length > 0) {
        (out as unknown as { sqlSchemas: string[] }).sqlSchemas = schemas;
      }
    }
    return out;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'chief-architect response could not be parsed — using empty design',
    );
    return {
      domainEntities: [], modules: [], dependencyMap: [],
      recommendedPhases: [], architectureMdUpdate: '',
    };
  }
}
