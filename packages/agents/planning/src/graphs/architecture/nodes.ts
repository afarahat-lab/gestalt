/**
 * ArchitectureGraph nodes (TR_051 / ADR-056 Phase 1).
 *
 * Each node is a thin wrapper around an agent class. The node:
 *   1. reads the relevant slice of graph state
 *   2. calls the agent's design()/review() method
 *   3. returns a partial state object the LangGraph reducer merges
 *
 * Errors are surfaced as state.errors entries (not thrown), so the
 * chief-architect can reconcile around a missing specialist slice
 * instead of dropping the whole graph. The orchestrator's outer
 * try/catch still handles a chief-side failure.
 */

import { createContextLogger } from '@gestalt/core';
import {
  DomainArchitectAgent, DataArchitectAgent,
  AppArchitectAgent, ChiefArchitectAgent,
} from './agents';
import type { ArchitectureGraphStateType } from './state';

const log = createContextLogger({ module: 'architecture-graph' });

export async function domainArchitectNode(
  state: ArchitectureGraphStateType,
): Promise<Partial<ArchitectureGraphStateType>> {
  const agent = new DomainArchitectAgent();
  try {
    const design = await agent.design(
      state.feature,
      state.existingArchitectureMd,
      state.goldenPrinciplesMd,
      state.projectRoot,
      state.harnessConfig,
      state.correlationId,
    );
    log.info(
      {
        correlationId: state.correlationId,
        featureId: state.feature.id,
        entityCount: design.domainEntities.length,
        ruleCount: design.businessRules.length,
        tokensUsed: agent.lastTokensUsed,
      },
      'domain-architect-node complete',
    );
    return { domainDesign: design, tokensUsed: agent.lastTokensUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { correlationId: state.correlationId, err: msg },
      'domain-architect-node failed — chief will reconcile around missing slice',
    );
    return { errors: [`domain-architect: ${msg}`] };
  }
}

export async function dataArchitectNode(
  state: ArchitectureGraphStateType,
): Promise<Partial<ArchitectureGraphStateType>> {
  const agent = new DataArchitectAgent();
  try {
    const design = await agent.design(
      state.feature,
      state.existingArchitectureMd,
      state.goldenPrinciplesMd,
      state.projectRoot,
      state.harnessConfig,
      state.correlationId,
    );
    log.info(
      {
        correlationId: state.correlationId,
        featureId: state.feature.id,
        schemaCount: design.sqlSchemas.length,
        repoCount: design.repositories.length,
        tokensUsed: agent.lastTokensUsed,
      },
      'data-architect-node complete',
    );
    return { dataDesign: design, tokensUsed: agent.lastTokensUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { correlationId: state.correlationId, err: msg },
      'data-architect-node failed — chief will reconcile around missing slice',
    );
    return { errors: [`data-architect: ${msg}`] };
  }
}

export async function appArchitectNode(
  state: ArchitectureGraphStateType,
): Promise<Partial<ArchitectureGraphStateType>> {
  const agent = new AppArchitectAgent();
  try {
    const design = await agent.design(
      state.feature,
      state.existingArchitectureMd,
      state.goldenPrinciplesMd,
      state.projectRoot,
      state.harnessConfig,
      state.correlationId,
    );
    log.info(
      {
        correlationId: state.correlationId,
        featureId: state.feature.id,
        moduleCount: design.modules.length,
        serviceCount: design.services.length,
        phaseCount: design.recommendedPhases.length,
        tokensUsed: agent.lastTokensUsed,
      },
      'app-architect-node complete',
    );
    return { appDesign: design, tokensUsed: agent.lastTokensUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { correlationId: state.correlationId, err: msg },
      'app-architect-node failed — chief will reconcile around missing slice',
    );
    return { errors: [`app-architect: ${msg}`] };
  }
}

export async function chiefArchitectNode(
  state: ArchitectureGraphStateType,
): Promise<Partial<ArchitectureGraphStateType>> {
  // TR_053 NRB-2 — log which specialists provided input and which
  // dropped out before reconciliation starts. The chief's prompt
  // already receives `state.errors` as a "Specialist errors" section
  // when populated; this log line surfaces the same picture to
  // operators tailing server logs.
  log.info(
    {
      correlationId: state.correlationId,
      featureId: state.feature.id,
      domainDesign: state.domainDesign ? 'present' : 'empty',
      dataDesign: state.dataDesign ? 'present' : 'empty',
      appDesign: state.appDesign ? 'present' : 'empty',
      priorErrors: state.errors,
    },
    'Chief architect reconciling specialist inputs',
  );
  const agent = new ChiefArchitectAgent();
  try {
    const finalArch = await agent.review(
      state.feature,
      state.domainDesign,
      state.dataDesign,
      state.appDesign,
      state.existingArchitectureMd,
      state.goldenPrinciplesMd,
      state.projectRoot,
      state.harnessConfig,
      state.correlationId,
      state.errors,
    );
    log.info(
      {
        correlationId: state.correlationId,
        featureId: state.feature.id,
        entityCount: finalArch.domainEntities.length,
        moduleCount: finalArch.modules.length,
        phaseCount: finalArch.recommendedPhases.length,
        priorErrors: state.errors.length,
        tokensUsed: agent.lastTokensUsed,
      },
      'chief-architect-node complete',
    );
    return {
      finalArchitecture: JSON.stringify(finalArch),
      tokensUsed: agent.lastTokensUsed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { correlationId: state.correlationId, err: msg },
      'chief-architect-node failed — runArchitectureGraph will throw',
    );
    return { errors: [`chief-architect: ${msg}`] };
  }
}
