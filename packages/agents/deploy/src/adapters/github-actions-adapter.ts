/**
 * GitHub Actions pipeline adapter (ADR-033).
 *
 * Talks to the GitHub REST API (https://api.github.com) using the
 * project's stored PAT. Same token that's used for `clone` + `push`
 * (`getRepositories().projects.getCredential(projectId)`); the
 * deploy-orchestrator injects it at adapter-construction time.
 *
 * Workflow contract — the project repo MUST contain a workflow file at
 * `.github/workflows/gestalt.yml` with a `workflow_dispatch` trigger
 * that the adapter dispatches. Promotion uses the same workflow with a
 * different `inputs.environment` value (`'staging' | 'production'`).
 *
 * PAT scopes:
 *   - `repo`     — required by createPullRequest and the surrounding
 *                  clone / push that pr-agent does
 *   - `workflow` — required by triggerPipeline + promoteToEnvironment
 *                  (workflow_dispatch endpoint)
 *
 * Missing-scope responses come back from GitHub as HTTP 403 with body
 * containing "Resource not accessible by personal access token". This
 * adapter detects that shape and throws `PipelineAdapterAuthError`, which
 * the deploy-orchestrator converts to a GOLDEN_PRINCIPLE_BREACH signal +
 * intent escalation (configuration error, never auto-retried).
 *
 * Reasons not yet supported:
 *   - GitHub Apps / fine-grained-token-scoped refresh
 *   - Re-running a single failed step (we only watch the whole run)
 *   - Streaming logs back to the orchestrator
 */

import {
  PipelineAdapterAuthError,
  type PipelineAdapter,
  type PipelineStatus,
} from './pipeline-adapter';

const GITHUB_API = 'https://api.github.com';
const WORKFLOW_FILE = 'gestalt.yml';

// Run discovery — GitHub does not return the runId from a workflow_dispatch
// call, so we poll `GET /actions/runs` until the newly-created run shows
// up. The initial 3s wait is the typical latency we've observed; the 10
// retries at 2s give 23s total before giving up.
const RUN_LOOKUP_INITIAL_DELAY_MS = 3_000;
const RUN_LOOKUP_MAX_ATTEMPTS = 10;
const RUN_LOOKUP_INTERVAL_MS = 2_000;
// Tolerance applied when filtering runs by `created_at >= dispatchedAt`.
// GitHub's run-creation timestamp may be slightly before the dispatch
// returns — a small negative skew keeps us from missing the right run.
const DISPATCH_CLOCK_SKEW_MS = 2_000;

export interface GitHubActionsAdapterOptions {
  /** PAT from project_git_credentials — needs `repo` + `workflow` scopes. */
  token: string;
  /** Parsed from the project's gitUrl. */
  owner: string;
  repo: string;
  /** Optional: override which workflow file gets dispatched. */
  workflowFile?: string;
}

export class GitHubActionsAdapter implements PipelineAdapter {
  readonly type = 'github-actions' as const;

  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly workflowFile: string;

  constructor(options: GitHubActionsAdapterOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.workflowFile = options.workflowFile ?? WORKFLOW_FILE;
  }

  /** Parse the `owner` + `repo` out of an HTTPS GitHub clone URL. */
  static parseOwnerRepo(gitUrl: string): { owner: string; repo: string } | null {
    try {
      const u = new URL(gitUrl);
      if (!u.hostname.endsWith('github.com')) return null;
      const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
      if (parts.length < 2) return null;
      return { owner: parts[0]!, repo: parts[1]! };
    } catch {
      return null;
    }
  }

  async createPullRequest(params: {
    projectId: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ prUrl: string; prNumber: number }> {
    const res = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      this.throwIfAuthError(res.status, body, 'createPullRequest', 'repo');
      throw new Error(`GitHub createPR failed (${res.status}): ${body}`);
    }
    const json = await res.json() as { html_url: string; number: number };
    return { prUrl: json.html_url, prNumber: json.number };
  }

  async triggerPipeline(params: {
    projectId: string;
    branch: string;
    correlationId: string;
  }): Promise<{ runId: string }> {
    // workflow_dispatch is fire-and-forget — GitHub does not return the
    // run id. Capture the dispatch timestamp first so we can filter the
    // run list to runs that were created after our dispatch (avoids
    // picking up concurrent runs on the same branch from other triggers).
    const dispatchedAt = Date.now();

    const dispatchRes = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: params.branch,
          inputs: {
            correlationId: params.correlationId,
            environment: 'ci',
            branch: params.branch,
          },
        }),
      },
    );
    if (!dispatchRes.ok) {
      const body = await dispatchRes.text();
      this.throwIfAuthError(dispatchRes.status, body, 'triggerPipeline', 'workflow');
      throw new Error(`GitHub dispatch failed (${dispatchRes.status}): ${body}`);
    }

    // Initial wait + retry loop so we don't race GitHub's run-creation.
    await sleep(RUN_LOOKUP_INITIAL_DELAY_MS);
    for (let attempt = 0; attempt < RUN_LOOKUP_MAX_ATTEMPTS; attempt++) {
      const runId = await this.findDispatchedRun(params.branch, dispatchedAt);
      if (runId !== null) return { runId };
      if (attempt < RUN_LOOKUP_MAX_ATTEMPTS - 1) {
        await sleep(RUN_LOOKUP_INTERVAL_MS);
      }
    }
    const waitedMs = RUN_LOOKUP_INITIAL_DELAY_MS + (RUN_LOOKUP_MAX_ATTEMPTS - 1) * RUN_LOOKUP_INTERVAL_MS;
    throw new Error(
      `GitHub Actions: dispatched workflow but no matching run appeared within ${Math.round(waitedMs / 1000)}s ` +
      `(branch=${params.branch})`,
    );
  }

  async getPipelineStatus(params: {
    runId: string;
  }): Promise<{ status: PipelineStatus }> {
    const res = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/runs/${params.runId}`,
    );
    if (!res.ok) {
      const body = await res.text();
      this.throwIfAuthError(res.status, body, 'getPipelineStatus', 'repo');
      throw new Error(`GitHub get-run failed (${res.status}): ${body}`);
    }
    const json = await res.json() as {
      status: string;
      conclusion: string | null;
    };
    // status: queued | in_progress | completed
    // conclusion (only set when status === 'completed'):
    //   success | failure | cancelled | timed_out | action_required | neutral | skipped | stale
    if (json.status !== 'completed') return { status: 'running' };
    if (json.conclusion === 'success') return { status: 'passed' };
    if (json.conclusion === 'cancelled') return { status: 'cancelled' };
    return { status: 'failed' };
  }

  async promoteToEnvironment(params: {
    correlationId: string;
    environment: 'staging' | 'production';
  }): Promise<{ deploymentUrl?: string }> {
    // Promotion fires the same workflow with `inputs.environment` set
    // — the project repo decides what that means (deploy to staging k8s,
    // promote staging build to production, etc.). The workflow is
    // responsible for surfacing the deployment URL; this adapter does
    // not currently retrieve it after the run finishes.
    const promoteRes = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          // Promotion runs from the default branch — by this point the
          // PR has merged, so the artifact set is on main.
          ref: 'main',
          inputs: {
            correlationId: params.correlationId,
            environment: params.environment,
          },
        }),
      },
    );
    if (!promoteRes.ok) {
      const body = await promoteRes.text();
      this.throwIfAuthError(promoteRes.status, body, 'promoteToEnvironment', 'workflow');
      throw new Error(`GitHub promote dispatch failed (${promoteRes.status}): ${body}`);
    }
    return {};
  }

  /**
   * Detect the specific 403 GitHub returns when the PAT is missing a
   * required scope and convert it to a typed `PipelineAdapterAuthError`.
   * The orchestrator handles this distinctly from generic adapter
   * failures.
   */
  private throwIfAuthError(
    status: number,
    body: string,
    operation: string,
    requiredScope: 'repo' | 'workflow',
  ): void {
    if (status !== 403) return;
    if (!body.includes('Resource not accessible')) return;
    throw new PipelineAdapterAuthError(
      `GitHub PAT lacks '${requiredScope}' scope. Re-run \`gestalt init\` (or ` +
      `\`gestalt projects set-adapter\`) with a PAT that has repo + workflow scopes.`,
      'github-actions',
      operation,
    );
  }

  /**
   * Look for the workflow run our dispatch created. Filters by:
   *   - branch (head_branch)
   *   - workflow_dispatch event
   *   - run was created AT OR AFTER the dispatch moment (minus a small
   *     skew tolerance) — this is what stops us from picking up a
   *     concurrent run from a different trigger
   * Returns the most recent matching run, or `null` if none yet.
   */
  private async findDispatchedRun(branch: string, dispatchedAt: number): Promise<string | null> {
    const url =
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/runs` +
      `?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&per_page=10`;
    const res = await this.fetch(url);
    if (!res.ok) {
      const body = await res.text();
      this.throwIfAuthError(res.status, body, 'run-lookup', 'repo');
      throw new Error(`GitHub run-lookup failed (${res.status}): ${body}`);
    }
    const body = await res.json() as {
      workflow_runs?: Array<{
        id: number;
        head_branch: string;
        status: string;
        created_at: string;
      }>;
    };
    const since = dispatchedAt - DISPATCH_CLOCK_SKEW_MS;
    const candidates = (body.workflow_runs ?? [])
      .filter((r) => r.head_branch === branch)
      .filter((r) => Date.parse(r.created_at) >= since)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return candidates[0] ? String(candidates[0].id) : null;
  }

  private fetch(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
