/**
 * NoOp pipeline adapter.
 *
 * The fallback used when a project's `HARNESS.json` does not configure
 * a `pipeline.adapter`. Returns plausible fake values immediately so the
 * deploy chain can run end-to-end (intent → PR → pipeline → staging →
 * production → `deployed`) without a real CI/CD system. Useful for:
 *
 *   - Bootstrapping new projects before CI is wired up
 *   - Smoke-testing the deploy layer itself
 *   - Internal demos / live walkthroughs
 *
 * The 500ms simulated pipeline delay is intentional — it lets dashboards
 * actually render the `running` → `passed` transition rather than
 * collapsing into a single instant.
 */

import type { PipelineAdapter, PipelineStatus } from './pipeline-adapter';

const SIMULATED_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export class NoOpPipelineAdapter implements PipelineAdapter {
  readonly type = 'noop' as const;

  /** When each fake `runId` was triggered — drives the `running → passed` flip. */
  private readonly runStartedAt = new Map<string, number>();

  async createPullRequest(params: {
    projectId: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ prUrl: string; prNumber: number }> {
    // Deterministic fake PR number from the branch name — same branch
    // always produces the same number, which is convenient for repeat
    // smoke tests.
    const prNumber = Math.abs(hashString(params.head)) % 9000 + 1000;
    return {
      prUrl: `noop://pr/${params.projectId}/${prNumber}`,
      prNumber,
    };
  }

  async triggerPipeline(params: {
    projectId: string;
    branch: string;
    correlationId: string;
  }): Promise<{ runId: string }> {
    const runId = `noop-run-${params.correlationId.slice(0, 8)}-${Date.now()}`;
    this.runStartedAt.set(runId, Date.now());
    return { runId };
  }

  async getPipelineStatus(params: {
    runId: string;
  }): Promise<{ status: PipelineStatus }> {
    const startedAt = this.runStartedAt.get(params.runId);
    if (startedAt === undefined) {
      // First poll after restart: treat as already passed so the
      // chain can recover rather than hanging.
      return { status: 'passed' };
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SIMULATED_DELAY_MS) {
      return { status: 'passed' };
    }
    // Wait out the rest of the delay then report passed. The orchestrator
    // polls on a 15s tick so this branch usually never executes.
    await sleep(SIMULATED_DELAY_MS - elapsed);
    return { status: 'passed' };
  }

  async promoteToEnvironment(params: {
    correlationId: string;
    environment: 'staging' | 'production';
  }): Promise<{ deploymentUrl?: string }> {
    return {
      deploymentUrl: `noop://deployment/${params.environment}/${params.correlationId.slice(0, 8)}`,
    };
  }

  async mergePullRequest(): Promise<{ merged: boolean; sha: string }> {
    return { merged: true, sha: 'noop-merge-sha' };
  }
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
