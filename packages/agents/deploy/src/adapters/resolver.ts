/**
 * Resolves the active PipelineAdapter for a deploy task.
 *
 * Reads `pipeline.adapter` from the project's `HARNESS.json` inside the
 * cloned working tree. Absent or unrecognised value → `NoOpPipelineAdapter`
 * so the deploy chain still progresses even on projects that have not
 * configured CI/CD.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { createContextLogger } from '@gestalt/core';
import { GitHubActionsAdapter } from './github-actions-adapter';
import { NoOpPipelineAdapter } from './noop-pipeline-adapter';
import type { PipelineAdapter, PipelineAdapterType } from './pipeline-adapter';

const log = createContextLogger({ module: 'pipeline-adapter:resolver' });

interface HarnessSubset {
  pipeline?: {
    adapter?: PipelineAdapterType | string;
  };
}

export async function resolvePipelineAdapter(args: {
  projectRoot: string;
  projectGitUrl: string;
  token: string;
  correlationId: string;
}): Promise<PipelineAdapter> {
  const declared = await readDeclaredAdapter(args.projectRoot);

  if (declared === 'github-actions') {
    const ownerRepo = GitHubActionsAdapter.parseOwnerRepo(args.projectGitUrl);
    if (!ownerRepo) {
      log.warn(
        { correlationId: args.correlationId, gitUrl: args.projectGitUrl },
        'github-actions configured but gitUrl is not parseable; falling back to noop',
      );
      return new NoOpPipelineAdapter();
    }
    log.info(
      { correlationId: args.correlationId, adapter: 'github-actions', owner: ownerRepo.owner, repo: ownerRepo.repo },
      'Resolved pipeline adapter',
    );
    return new GitHubActionsAdapter({ token: args.token, owner: ownerRepo.owner, repo: ownerRepo.repo });
  }

  if (declared && declared !== 'noop') {
    log.warn(
      { correlationId: args.correlationId, declared },
      `Adapter '${declared}' is not yet implemented — falling back to NoOpPipelineAdapter`,
    );
  } else {
    log.info({ correlationId: args.correlationId, adapter: 'noop' }, 'Resolved pipeline adapter');
  }
  return new NoOpPipelineAdapter();
}

async function readDeclaredAdapter(projectRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as HarnessSubset;
    return parsed.pipeline?.adapter?.toString() ?? null;
  } catch {
    return null;
  }
}
