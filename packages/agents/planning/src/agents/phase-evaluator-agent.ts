/**
 * phase-evaluator-agent — reviews a completed phase against its plan,
 * decides whether the phase succeeded, partially succeeded, or needs
 * escalation, and recommends adjustments to the remaining phases.
 *
 * The evaluation criteria come from
 * `HARNESS.json.agentConfig['phase-evaluator-agent'].evaluationCriteria`
 * + `agents.yaml`'s `prompt_extensions` — NOT hardcoded here.
 *
 * TR_026 — the agent now uses `executeScript` to run git commands
 * directly against the cycle's cloned work-dir and read the file
 * diff itself. The platform no longer pre-computes the file list;
 * it only passes the branch names as context. Per ADR-050: LLM
 * evaluates evidence, platform routes the verdict.
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

/**
 * TR_026 — branch context the orchestrator passes to the agent.
 * The agent uses these names verbatim in its `git diff` calls via
 * `executeScript`. `phaseBranch` is null only on the rare case the
 * intent never received a branchName (e.g. pr-agent failed before
 * persisting it); the agent handles that case by reporting via
 * its own evidence-quoting.
 */
export interface PhaseBranchContext {
  defaultBranch: string;
  phaseBranch: string | null;
}

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
    branchContext: PhaseBranchContext,
    remainingPhases: FeaturePhaseRecord[],
    projectRoot: string,
    harnessConfig: HarnessConfig | null,
    correlationId: string,
  ): Promise<PhaseEvaluation> {
    this.lastTokensUsed = 0;
    const agentCfg = await loadAgentConfig(projectRoot, 'phase-evaluator-agent');
    const prompt = buildPhaseEvaluationPrompt(
      feature, completedPhase, branchContext, remainingPhases,
      agentCfg, harnessConfig,
    );
    // TR_026 — the evaluator now runs in the tool-use loop with
    // `executeScript` available so it can call git itself. The
    // tool list comes from `agents.yaml.phase-evaluator-agent.tools`
    // (operator-tunable per ADR-042) or the per-role default in
    // `PER_ROLE_DEFAULTS` (which includes executeScript so the
    // git-diff path works out of the box).
    const { response } = await this.callLLMWithTools(
      prompt,
      agentCfg,
      projectRoot,
      correlationId,
    );
    return parsePhaseEvaluation(response, correlationId);
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
    const builtFilesIn = Array.isArray(parsed.builtFiles) ? parsed.builtFiles : [];
    const builtFiles: PhaseEvaluation['builtFiles'] = [];
    for (const entry of builtFilesIn) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const path = typeof e['path'] === 'string' ? e['path'].trim() : '';
      if (!path) continue;
      const exportsIn = Array.isArray(e['exports']) ? e['exports'] as unknown[] : [];
      const exports = exportsIn.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
      builtFiles.push(exports.length > 0 ? { path, exports } : { path });
    }
    return { verdict, summary, adjustments, builtFiles };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), correlationId },
      'phase-evaluator-agent response could not be parsed — defaulting to success / no adjustments',
    );
    return { verdict: 'success', summary: '', adjustments: [] };
  }
}
