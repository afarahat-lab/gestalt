/**
 * ArchitectureGraph state (TR_051 / ADR-056 Phase 1).
 *
 * Three specialist nodes deliberate in parallel:
 *   - DomainArchitectNode   → state.domainDesign
 *   - DataArchitectNode     → state.dataDesign
 *   - AppArchitectNode      → state.appDesign
 *
 * The ChiefArchitectNode receives all three and writes the final
 * reconciled FeatureArchitecture into state.finalArchitecture.
 *
 * `harnessConfig` carries the project's HARNESS.json — every node
 * passes it to its agent so per-agent rules / architectureGuidance
 * surface through the standard `renderHarnessAgentRules` path.
 *
 * `projectRoot` is the cloned-repo work directory; nodes load their
 * agents.yaml entry via `loadAgentConfig(projectRoot, role)` exactly
 * like every other LLM agent on the platform.
 *
 * `errors` accumulates one entry per failing specialist so the
 * ChiefArchitectNode (and the orchestrator) can see which specialist
 * dropped out before reconciliation begins.
 */

import { Annotation } from '@langchain/langgraph';
import type { FeatureRecord, HarnessConfig } from '@gestalt/core';
import type { DomainDesign, DataDesign, AppDesign } from './types';

export const ArchitectureGraphState = Annotation.Root({
  // ─── Inputs (set by runArchitectureGraph) ────────────────────────
  feature: Annotation<FeatureRecord>({
    reducer: (_a, b) => b,
    default: () => ({
      id: '',
      projectId: '',
      title: '',
      description: '',
      status: 'planning',
      architecture: null,
      phaseCount: 0,
      currentPhase: 0,
      createdBy: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as FeatureRecord),
  }),
  existingArchitectureMd: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  goldenPrinciplesMd: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  harnessConfig: Annotation<HarnessConfig | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  projectRoot: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  correlationId: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),

  // ─── Parallel specialist outputs ─────────────────────────────────
  domainDesign: Annotation<DomainDesign | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  dataDesign: Annotation<DataDesign | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  appDesign: Annotation<AppDesign | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Chief output ────────────────────────────────────────────────
  finalArchitecture: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Error tracking ──────────────────────────────────────────────
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  // ─── Telemetry ───────────────────────────────────────────────────
  // Cumulative token count across all four specialist + chief calls.
  // Surfaces in `runArchitectureGraph`'s return value so the
  // orchestrator can append it to the feature plan log.
  tokensUsed: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
});

export type ArchitectureGraphStateType = typeof ArchitectureGraphState.State;
