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
 * Reasons not yet supported:
 *   - GitHub Apps / fine-grained-token-scoped refresh
 *   - Re-running a single failed step (we only watch the whole run)
 *   - Streaming logs back to the orchestrator
 */

import type { PipelineAdapter, PipelineStatus } from './pipeline-adapter';

const GITHUB_API = 'https://api.github.com';
const WORKFLOW_FILE = 'gestalt.yml';

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
      throw new Error(`GitHub createPR failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json() as { html_url: string; number: number };
    return { prUrl: json.html_url, prNumber: json.number };
  }

  async triggerPipeline(params: {
    projectId: string;
    branch: string;
    correlationId: string;
  }): Promise<{ runId: string }> {
    // workflow_dispatch is fire-and-forget: GitHub does not return the
    // run id, so we dispatch then immediately query the most recent run
    // for the branch + workflow + correlationId-tagged input.
    const dispatchRes = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: params.branch,
          inputs: {
            correlationId: params.correlationId,
            environment: 'ci',
          },
        }),
      },
    );
    if (!dispatchRes.ok) {
      throw new Error(`GitHub dispatch failed (${dispatchRes.status}): ${await dispatchRes.text()}`);
    }

    // Brief delay to let GitHub register the run, then look it up.
    await sleep(2_000);
    const lookup = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/runs?branch=${encodeURIComponent(params.branch)}&event=workflow_dispatch&per_page=5`,
    );
    if (!lookup.ok) {
      throw new Error(`GitHub run-lookup failed (${lookup.status}): ${await lookup.text()}`);
    }
    const body = await lookup.json() as {
      workflow_runs?: Array<{ id: number; head_branch: string; status: string }>;
    };
    const run = body.workflow_runs?.find((r) => r.head_branch === params.branch);
    if (!run) {
      throw new Error('GitHub Actions: dispatched but no matching run appeared');
    }
    return { runId: String(run.id) };
  }

  async getPipelineStatus(params: {
    runId: string;
  }): Promise<{ status: PipelineStatus }> {
    const res = await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/runs/${params.runId}`,
    );
    if (!res.ok) {
      throw new Error(`GitHub get-run failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json() as {
      status: string;
      conclusion: string | null;
    };
    // status: queued | in_progress | completed
    // conclusion: success | failure | cancelled | timed_out | ...
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
    const branch = `gestalt/promote-${params.correlationId.slice(0, 8)}`;
    await this.fetch(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            correlationId: params.correlationId,
            environment: params.environment,
            branch,
          },
        }),
      },
    );
    return {};
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
