/**
 * @gestalt/agents-deploy — PipelineAdapter (ADR-033).
 *
 * The minimum interface the deploy-layer agents need to interact with a
 * CI/CD system. Every concrete adapter (GitHub Actions, Azure DevOps,
 * GitLab CI, Jenkins) and the NoOp fallback implement this interface.
 *
 * Agents never call CI/CD systems directly; they go through the
 * resolved adapter, which is selected at deploy-orchestrator-task time
 * from the project's HARNESS.json `pipeline.adapter` field. Missing
 * `pipeline.adapter` → `NoOpPipelineAdapter` so the deploy chain still
 * progresses end-to-end on a project that has no CI/CD configured.
 */

export interface PipelineAdapter {
  /** Stable name used for logs + harness selection. */
  readonly type: PipelineAdapterType;

  /**
   * Open a pull request against the project's default branch. Returns
   * the external PR URL and number so the orchestrator can store them
   * in `deployment_events`.
   */
  createPullRequest(params: {
    projectId: string;
    title: string;
    body: string;
    head: string;     // feature branch (e.g. `gestalt/<corr8>-<slug>`)
    base: string;     // project default branch
  }): Promise<{ prUrl: string; prNumber: number }>;

  /**
   * Trigger a CI/CD pipeline run for `branch`. Returns an opaque
   * `runId` the orchestrator polls via `getPipelineStatus`.
   */
  triggerPipeline(params: {
    projectId: string;
    branch: string;
    correlationId: string;
  }): Promise<{ runId: string }>;

  /**
   * Current state of a previously-triggered run. Adapters MUST return
   * `'running'` until the pipeline reaches a terminal state, then one
   * of `'passed' | 'failed' | 'cancelled'`.
   */
  getPipelineStatus(params: {
    runId: string;
  }): Promise<{ status: PipelineStatus }>;

  /**
   * Promote the cycle's deployment to the target environment. The
   * promotion-agent calls this AFTER its ADR-034 staging-confirmed
   * check has passed.
   */
  promoteToEnvironment(params: {
    correlationId: string;
    environment: 'staging' | 'production';
  }): Promise<{ deploymentUrl?: string }>;

  /**
   * Merge an open pull request on the project's host (GitHub, etc.).
   * Called by the promotion-agent ONLY when `HARNESS.json`
   * `pipeline.autoMerge === true` and staging promotion has succeeded —
   * never during the gate or before CI passes. Defaults `mergeMethod`
   * to `'squash'` so the project history records one commit per intent
   * cycle.
   *
   * Failure semantics: throwing here is non-fatal at the orchestrator
   * boundary — the PR stays open for manual review and the intent still
   * proceeds to production. The promotion-agent catches the throw and
   * emits a `deployment.updated` SSE event with `status:
   * 'auto-merge-failed'` so the dashboard can surface it.
   */
  mergePullRequest(params: {
    projectId: string;
    prNumber: number;
    /** `'squash' | 'merge' | 'rebase'`. Default: `'squash'`. */
    mergeMethod?: 'merge' | 'squash' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
  }): Promise<{ merged: boolean; sha: string }>;

  /**
   * TR_027 / ADR-051 — read the latest review verdict posted by
   * CodiumAI PR-Agent (or a future equivalent bot) on `prNumber`.
   *
   *   - 'approved'           → PR-Agent gave a thumbs-up
   *   - 'changes-requested'  → PR-Agent flagged issues
   *   - 'pending'            → the review hasn't been posted yet
   *   - 'none'               → PR-Agent isn't configured / there
   *                            is no bot review on the PR
   *
   * Optional on the interface so non-GitHub adapters (NoOp, Azure,
   * GitLab) can implement when they have an equivalent integration.
   * When absent or returning 'none', pipeline-agent dispatches the
   * gate as if PR-Agent never ran.
   */
  getPrAgentVerdict?(params: {
    projectId: string;
    prNumber: number;
  }): Promise<'approved' | 'changes-requested' | 'pending' | 'none'>;

  /**
   * TR_027 / ADR-051 — fetch the body of PR-Agent's most recent
   * review on `prNumber` so the self-healing diagnostician can read
   * the actual feedback. Capped at ~3 KB by the implementation.
   * Empty string when PR-Agent isn't configured or has no review.
   */
  getPrAgentComment?(params: {
    projectId: string;
    prNumber: number;
  }): Promise<string>;
}

export type PipelineAdapterType =
  | 'github-actions'
  | 'azure-devops'
  | 'gitlab-ci'
  | 'jenkins'
  | 'noop';

export type PipelineStatus = 'running' | 'passed' | 'failed' | 'cancelled';

/**
 * Thrown by a PipelineAdapter when the configured credential is missing
 * a required scope (e.g. GitHub PAT without `workflow` scope). This is a
 * configuration error that requires human intervention — retries will
 * never succeed. The deploy-orchestrator catches this specifically,
 * emits a GOLDEN_PRINCIPLE_BREACH signal, and escalates the intent
 * (never marks it `failed`, which would imply a transient problem).
 */
export class PipelineAdapterAuthError extends Error {
  readonly kind: 'auth-error' = 'auth-error';
  constructor(
    message: string,
    /** The adapter type that surfaced the error — for the signal message. */
    public readonly adapter: PipelineAdapterType,
    /** Which operation hit the auth wall (`dispatch` / `createPR` / `promote`). */
    public readonly operation: string,
  ) {
    super(message);
    this.name = 'PipelineAdapterAuthError';
  }
}
