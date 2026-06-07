/**
 * phase-evaluator-agent — reviews a completed phase against its plan,
 * decides whether the phase succeeded, partially succeeded, or needs
 * escalation, and recommends adjustments to the remaining phases.
 *
 * The evaluation criteria come from
 * `HARNESS.json.agentConfig['phase-evaluator-agent'].evaluationCriteria`
 * + `agents.yaml`'s `prompt_extensions` — NOT hardcoded here.
 */

import {
  BaseLLMAgent, loadAgentConfig, extractJsonObject, createContextLogger,
} from '@gestalt/core';
import type {
  HarnessConfig, FeatureRecord, FeaturePhaseRecord,
} from '@gestalt/core';
import { buildPhaseEvaluationPrompt } from '../prompts/evaluator-prompt';
import type { PhaseEvaluation } from '../types';

const log = createContextLogger({ module: 'phase-evaluator-agent' });

export class PhaseEvaluatorAgent extends BaseLLMAgent {
  constructor() { super('phase-evaluator-agent'); }

  protected buildPrompt(): string {
    throw new Error('PhaseEvaluatorAgent.buildPrompt() is not used — see evaluatePhase()');
  }
  protected parseResponse(): unknown {
    throw new Error('PhaseEvaluatorAgent.parseResponse() is not used');
  }

  async evaluatePhase(
    feature: FeatureRecord,
    completedPhase: FeaturePhaseRecord,
    builtFilePaths: string[],
    remainingPhases: FeaturePhaseRecord[],
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<PhaseEvaluation> {
    this.lastTokensUsed = 0;
    const agentCfg = await loadAgentConfig(projectRoot, 'phase-evaluator-agent');
    const prompt = buildPhaseEvaluationPrompt(
      feature, completedPhase, builtFilePaths, remainingPhases,
      agentCfg, harnessConfig,
    );
    const raw = await this.callLLM(prompt, agentCfg, correlationId);
    return parsePhaseEvaluation(raw, correlationId);
  }
}

function parsePhaseEvaluation(raw: string, correlationId: string): PhaseEvaluation {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<PhaseEvaluation>;
    const verdict: PhaseEvaluation['verdict'] =
      parsed.verdict === 'success' || parsed.verdict === 'partial' || parsed.verdict === 'escalate'
        ? parsed.verdict
        : 'success';
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const adjustmentsIn = Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
    const adjustments: PhaseEvaluation['adjustments'] = [];
    for (const entry of adjustmentsIn) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const phaseTitle = typeof e['phaseTitle'] === 'string' ? e['phaseTitle'] : '';
      const reason = typeof e['reason'] === 'string' ? e['reason'] : '';
      if (!phaseTitle || !reason) continue;
      const adj: PhaseEvaluation['adjustments'][number] = { phaseTitle, reason };
      if (typeof e['updatedScope'] === 'string') adj.updatedScope = e['updatedScope'];
      if (Array.isArray(e['updatedDependencies'])) {
        adj.updatedDependencies = (e['updatedDependencies'] as unknown[])
          .filter((d): d is string => typeof d === 'string');
      }
      adjustments.push(adj);
    }
    return { verdict, summary, adjustments };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'phase-evaluator-agent response could not be parsed — defaulting to success / no adjustments',
    );
    return { verdict: 'success', summary: '', adjustments: [] };
  }
}
