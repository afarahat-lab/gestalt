/**
 * gestalt feature — planning layer command (migration 024).
 *
 *   gestalt feature "<description>" [--project <name>] [--title <text>]
 *   gestalt feature list [--project <name>]
 *   gestalt feature show <id>
 *
 * The submit form sends `POST /features`; the server creates the
 * feature row and dispatches `planning:start` on the planning queue.
 * From there the planning orchestrator drives architecture-agent →
 * planner-agent → first phase → gate → deploy → evaluator → next phase
 * autonomously.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { c, blank, divider, createSpinner, statusBadge } from '../ui/prompts';
import { resolveProjectId } from '../ui/resolve';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';

interface FeatureOptions {
  server?: string;
  project?: string;
  title?: string;
}

interface FeatureListOptions {
  server?: string;
  project?: string;
}

interface FeatureShowOptions {
  server?: string;
}

function shortTitleFromDescription(description: string): string {
  // Pick the first sentence or first 80 chars as a default title.
  const firstSentence = description.split(/[.!?]\s/)[0] ?? description;
  return firstSentence.slice(0, 80).trim();
}

export async function featureSubmitCommand(description: string, options: FeatureOptions): Promise<void> {
  if (!description?.trim()) {
    console.log(c.error('Feature description is required.'));
    console.log(c.dim('Usage: gestalt feature "<describe the feature>"'));
    process.exit(1);
  }
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });

  const projectId = await resolveProjectId(client, config.currentProjectId, options.project);
  if (!projectId) {
    console.log(c.error('No project set. Run: gestalt init'));
    process.exit(1);
  }

  const title = options.title?.trim() || shortTitleFromDescription(description.trim());

  blank();
  const spinner = createSpinner('Submitting feature...');
  spinner.start();
  try {
    const response = await client.submitFeature({
      title,
      description: description.trim(),
      projectId,
    });
    spinner.succeed(c.success('Feature submitted'));
    blank();
    divider();
    console.log(`${c.bold('Feature:')} ${response.data.title}`);
    console.log(`${c.dim('ID:')}      ${response.data.id}`);
    console.log(`${c.dim('Status:')}  ${statusBadge(String(response.data.status))}`);
    divider();
    blank();
    console.log(c.dim('Watch progress with:'));
    console.log(c.dim(`  gestalt feature show ${response.data.id}`));
    blank();
  } catch (err) {
    spinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function featureListCommand(options: FeatureListOptions): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });

  let projectId: string | undefined;
  if (options.project) {
    const resolved = await resolveProjectId(client, config.currentProjectId, options.project);
    projectId = resolved ?? undefined;
  } else if (config.currentProjectId) {
    projectId = config.currentProjectId;
  }

  try {
    const params: { projectId?: string } = {};
    if (projectId) params.projectId = projectId;
    const response = await client.listFeatures(params);
    if (response.data.length === 0) {
      console.log(c.dim('No features.'));
      return;
    }
    blank();
    console.log(c.bold(`Features (${response.total})`));
    divider();
    for (const f of response.data) {
      const progress = `${f.currentPhase}/${f.phaseCount}`;
      console.log(
        `${c.dim(f.id.slice(0, 8))}  ${statusBadge(f.status).padEnd(20)} ` +
        `${c.dim(progress.padStart(5))}  ${f.title}`,
      );
    }
    divider();
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function featureShowCommand(id: string, options: FeatureShowOptions): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });

  try {
    const response = await client.getFeature(id);
    const f = response.data;
    blank();
    console.log(c.bold(f.title));
    console.log(c.dim(`ID:      ${f.id}`));
    console.log(c.dim(`Status:  `) + statusBadge(f.status));
    console.log(c.dim(`Phases:  ${f.currentPhase}/${f.phaseCount}`));
    blank();
    console.log(c.bold('Description'));
    console.log(f.description);
    blank();
    if (f.phases.length > 0) {
      console.log(c.bold('Phases'));
      divider();
      for (const p of f.phases) {
        const mark = p.status === 'deployed' ? c.success('●')
          : p.status === 'in-progress' ? c.info('◎')
          : p.status === 'failed' ? c.error('✗')
          : c.dim('○');
        console.log(`${mark} Phase ${p.phaseIndex + 1}: ${p.title} ${c.dim(`[${p.status}]`)}`);
        if (p.intentId) {
          console.log(`    ${c.dim(`intent ${p.intentId.slice(0, 8)}`)}`);
        }
      }
      divider();
      blank();
    }
    if (f.planLog.length > 0) {
      console.log(c.bold('Plan log'));
      divider();
      for (const e of f.planLog.slice(-15)) {
        const phaseTag = e.phaseIndex !== null ? `[phase ${e.phaseIndex + 1}] ` : '';
        console.log(`${c.dim(new Date(e.createdAt).toISOString().slice(11, 19))}  ${c.info(e.eventType)} ${phaseTag}${e.summary}`);
      }
      divider();
      blank();
    }
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}
