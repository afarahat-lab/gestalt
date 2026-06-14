/**
 * ArchitectureGraph — LangGraph StateGraph (TR_051 / ADR-056 Phase 1).
 *
 * Replaces the single architecture-agent + reviewDesign stopgap with
 * a deliberating crew:
 *
 *   START → [domain || data || app] → chief → END
 *
 * Each of the three specialists fans out from START in parallel;
 * the chief fan-in supervisor runs after all three have completed.
 * The compiled graph is cached process-wide because compilation is
 * pure-structural (no state) — the per-invocation thread is keyed
 * by `correlationId` on `runArchitectureGraph` callers.
 *
 * Retry policy: every node uses an identical 3-attempt exponential
 * backoff that triggers on the same transient errors classifyError
 * recognised in TR_050 (timeouts, sockets, 5xx, 429). The chief
 * caps at 2 attempts because a chief failure means the specialists
 * already burned their budget — better to surface the error than
 * pay another 12k-token call.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/**
 * Local mirror of LangGraph's `RetryPolicy` shape. The type lives
 * under `dist/pregel/utils.js` in the package and isn't re-exported
 * from the public entry, so we describe the structure locally. The
 * runtime accepts duck-typed objects.
 */
interface RetryPolicy {
  initialInterval?: number;
  backoffFactor?: number;
  maxInterval?: number;
  maxAttempts?: number;
  jitter?: boolean;
  retryOn?: (err: unknown) => boolean;
  logWarning?: boolean;
}
import { createContextLogger } from '@gestalt/core';
import type { FeatureRecord, HarnessConfig } from '@gestalt/core';
import { ArchitectureGraphState } from './state';
import {
  domainArchitectNode, dataArchitectNode,
  appArchitectNode, chiefArchitectNode,
} from './nodes';
import { getCheckpointer } from '../checkpointer';
import type { FeatureArchitecture } from '../../types';

const log = createContextLogger({ module: 'architecture-graph' });

// ─── Retry policy ────────────────────────────────────────────────────

const specialistRetryPolicy: RetryPolicy = {
  initialInterval: 1000,
  backoffFactor: 2.0,
  maxInterval: 30000,
  maxAttempts: 3,
  jitter: true,
  retryOn: (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      /timeout|timed out/i.test(msg) ||
      /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(msg) ||
      /\b(429|502|503|504)\b/.test(msg) ||
      /fetch failed/i.test(msg)
    );
  },
};

const chiefRetryPolicy: RetryPolicy = {
  ...specialistRetryPolicy,
  maxAttempts: 2,
};

// ─── Graph builder ───────────────────────────────────────────────────

let cachedGraph: ReturnType<typeof compileGraph> | null = null;

function compileGraph(checkpointer: PostgresSaver) {
  const workflow = new StateGraph(ArchitectureGraphState)
    .addNode('domain-architect', domainArchitectNode, { retryPolicy: specialistRetryPolicy })
    .addNode('data-architect', dataArchitectNode, { retryPolicy: specialistRetryPolicy })
    .addNode('app-architect', appArchitectNode, { retryPolicy: specialistRetryPolicy })
    .addNode('chief-architect', chiefArchitectNode, { retryPolicy: chiefRetryPolicy })
    // START → all three specialists fan out in parallel
    .addEdge(START, 'domain-architect')
    .addEdge(START, 'data-architect')
    .addEdge(START, 'app-architect')
    // Three specialist edges into the chief — LangGraph waits for
    // ALL three before chief-architect runs
    .addEdge('domain-architect', 'chief-architect')
    .addEdge('data-architect', 'chief-architect')
    .addEdge('app-architect', 'chief-architect')
    .addEdge('chief-architect', END);

  return workflow.compile({ checkpointer });
}

// ─── Public interface ────────────────────────────────────────────────

export interface RunArchitectureGraphInput {
  feature: FeatureRecord;
  existingArchitectureMd: string;
  goldenPrinciplesMd: string;
  projectRoot: string;
  harnessConfig: HarnessConfig | null;
  correlationId: string;
}

export interface RunArchitectureGraphResult {
  architecture: FeatureArchitecture;
  tokensUsed: number;
  errors: string[];
}

/**
 * Drives the four-node crew end-to-end. Replaces the single
 * `architectureAgent.designFeature()` + `reviewDesign()` call pair
 * in the planning orchestrator (`handlePlanningStart`).
 *
 * Throws when the chief produces no usable output — the orchestrator's
 * outer catch block marks the feature `blocked` (same behaviour as
 * the pre-migration path). Specialist errors don't throw — they're
 * surfaced in `result.errors` so the orchestrator can log them but
 * the chief still gets a chance to reconcile around them.
 */
export async function runArchitectureGraph(
  input: RunArchitectureGraphInput,
): Promise<RunArchitectureGraphResult> {
  const checkpointer = await getCheckpointer();
  if (!cachedGraph) {
    cachedGraph = compileGraph(checkpointer);
    log.info('ArchitectureGraph compiled and cached');
  }
  const graph = cachedGraph;

  log.info(
    { correlationId: input.correlationId, featureId: input.feature.id },
    'Invoking ArchitectureGraph',
  );
  const finalState = await graph.invoke(
    {
      feature: input.feature,
      existingArchitectureMd: input.existingArchitectureMd,
      goldenPrinciplesMd: input.goldenPrinciplesMd,
      harnessConfig: input.harnessConfig,
      projectRoot: input.projectRoot,
      correlationId: input.correlationId,
    },
    {
      configurable: { thread_id: input.correlationId },
    },
  );

  if (!finalState.finalArchitecture) {
    throw new Error(
      `Architecture graph produced no final output. Errors: ${
        finalState.errors.length > 0 ? finalState.errors.join('; ') : '(none)'
      }`,
    );
  }
  const architecture = JSON.parse(finalState.finalArchitecture) as FeatureArchitecture;
  // Guard against a chief response that parsed to empty — the
  // single-agent path used to fall back to the draft; with the crew
  // there's no draft to fall back to, so treat empty as a graph
  // failure and let the orchestrator block the feature.
  if (
    architecture.domainEntities.length === 0 &&
    architecture.modules.length === 0 &&
    architecture.recommendedPhases.length === 0
  ) {
    throw new Error(
      `Architecture graph chief produced empty output. Errors: ${
        finalState.errors.length > 0 ? finalState.errors.join('; ') : '(none)'
      }`,
    );
  }

  log.info(
    {
      correlationId: input.correlationId,
      featureId: input.feature.id,
      entities: architecture.domainEntities.length,
      modules: architecture.modules.length,
      phases: architecture.recommendedPhases.length,
      tokensUsed: finalState.tokensUsed,
      specialistErrors: finalState.errors.length,
    },
    'ArchitectureGraph complete',
  );

  return {
    architecture,
    tokensUsed: finalState.tokensUsed,
    errors: finalState.errors,
  };
}
