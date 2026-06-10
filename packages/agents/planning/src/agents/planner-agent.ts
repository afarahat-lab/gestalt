/**
 * planner-agent — decomposes a feature into an ordered list of small,
 * independently deployable phases. Reads phaseScopingRules and rules
 * from `HARNESS.json.agentConfig['planner-agent']` via the shared
 * `renderHarnessAgentRules` helper called from `planner-prompt.ts`.
 *
 * No hardcoded scoping examples in this file — all "GOOD scope:" /
 * "BAD scope:" guidance flows in from HARNESS.json so operators can
 * tune per project without touching platform code.
 */

import {
  BaseLLMAgent, loadAgentConfig, extractJsonObject, createContextLogger,
} from '@gestalt/core';
import type { HarnessConfig, FeatureRecord } from '@gestalt/core';
import { buildFeaturePlanPrompt } from '../prompts/planner-prompt';
import type { FeatureArchitecture, FeaturePlan } from '../types';

const log = createContextLogger({ module: 'planner-agent' });

export class PlannerAgent extends BaseLLMAgent {
  constructor() { super('planner-agent'); }

  protected buildPrompt(): string {
    throw new Error('PlannerAgent.buildPrompt() is not used — see planFeature()');
  }
  protected parseResponse(): unknown {
    throw new Error('PlannerAgent.parseResponse() is not used');
  }

  /**
   * Produce a phase plan for a feature. The orchestrator caps the
   * returned phase count to the HARNESS-supplied bound; an LLM that
   * returns more is truncated rather than failing the cycle.
   */
  async planFeature(
    feature: FeatureRecord,
    architecture: FeatureArchitecture,
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    bounds: { maxPhases: number; maxFilesPerPhase: number },
    correlationId: string,
  ): Promise<FeaturePlan> {
    this.lastTokensUsed = 0;
    // TR_035 / ADR-057 — Layer 3 + 5 read knobs from harnessConfig.
    this.setHarnessConfigForRun(harnessConfig);
    const agentCfg = await loadAgentConfig(projectRoot, 'planner-agent');
    const prompt = this.addJsonResponseGuard(
      buildFeaturePlanPrompt(
        feature, architecture, agentCfg, harnessConfig, bounds,
      ),
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    const plan = parseFeaturePlan(raw, correlationId);

    if (plan.phases.length > bounds.maxPhases) {
      log.warn(
        { returned: plan.phases.length, cap: bounds.maxPhases, correlationId },
        'planner-agent returned more phases than the HARNESS cap — truncating',
      );
      plan.phases = plan.phases.slice(0, bounds.maxPhases);
    }

    return plan;
  }
}

function parseFeaturePlan(raw: string, correlationId: string): FeaturePlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as { phases?: unknown };
    const phasesIn = Array.isArray(parsed.phases) ? parsed.phases : [];
    const phases: FeaturePlan['phases'] = [];
    for (const entry of phasesIn) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const title = typeof e['title'] === 'string' ? e['title'].trim() : '';
      const scope = typeof e['scope'] === 'string' ? e['scope'].trim() : '';
      if (!title || !scope) continue;
      const dependenciesIn = Array.isArray(e['dependencies']) ? e['dependencies'] : [];
      const dependencies = dependenciesIn
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
      const architecture = typeof e['architecture'] === 'string' ? e['architecture'] : undefined;
      const phase: FeaturePlan['phases'][number] = { title, scope, dependencies };
      if (architecture) phase.architecture = architecture;
      phases.push(phase);
    }
    return { phases };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'planner-agent response could not be parsed — returning empty plan',
    );
    return { phases: [] };
  }
}
