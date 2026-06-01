/**
 * Deployment routes.
 *
 *   GET /deployments?projectId=<id>&limit=20
 *
 * Returns one row per intent that has at least one deployment_events
 * row, enriched with the full event timeline so the dashboard can
 * render the four-node pipeline (PR → Pipeline → Staging →
 * Production). Powers the Deployments view.
 *
 * Only deployment-shaped statuses (`deploying`, `deployed`, `failed`)
 * are scanned. Gate-failed intents that never reached pr-agent have no
 * deployment_events and are filtered out client-side via the
 * `events.length > 0` guard below.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories,
  type IntentRecord, type DeploymentEventRecord,
} from '@gestalt/core';
import { checkProjectMembership } from '../auth/middleware';

interface ListQuery {
  projectId?: string;
  limit?: string;
}

interface DeploymentSummary {
  intentId: string;
  correlationId: string;
  intentText: string;
  status: string;
  events: DeploymentEventRecord[];
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  runId: string | null;
  deploymentUrl: string | null;
  startedAt: string;
  completedAt: string | null;
}

const DEPLOY_STATUSES = ['deploying', 'deployed', 'failed'] as const;

export async function registerDeploymentRoutes(app: FastifyInstance): Promise<void> {

  // Handler-level membership check covers authorization; the
  // `requireRole('viewer')` preHandler is intentionally dropped here
  // because it would run a redundant membership lookup with the
  // older error shape (`{ error: 'Not a member of this project' }`)
  // and short-circuit before our typed
  // `INSUFFICIENT_PROJECT_ROLE / NOT_PROJECT_MEMBER` reply.
  app.get<{ Querystring: ListQuery }>(
    '/deployments',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const projectId = request.query.projectId;
      if (!projectId?.trim()) {
        return reply.code(400).send({ error: 'projectId is required' });
      }
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, projectId)) return;
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '20', 10) || 20, 1), 100);

      const { intents, deploymentEvents } = getRepositories();

      // Fetch the three deploy-related status buckets in parallel; the
      // intents repo only supports one status at a time.
      const buckets = await Promise.all(
        DEPLOY_STATUSES.map((status) => intents.list({
          projectId,
          status,
          limit,
          offset: 0,
        })),
      );

      // Merge, sort by createdAt DESC (newest first), cap to `limit`.
      // Same intent never appears twice — status is unique per row.
      const merged: IntentRecord[] = buckets
        .flatMap((b) => b.records)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);

      // Per-intent deployment_events; drop intents with no events so a
      // gate-failed cycle that never reached pr-agent is not rendered
      // as an empty deployment card.
      const summaries: DeploymentSummary[] = [];
      await Promise.all(merged.map(async (intent) => {
        const events = await deploymentEvents.findByCorrelationId(intent.correlationId);
        if (events.length === 0) return;

        // findByCorrelationId already orders DESC in the Postgres repo;
        // the brief asks for ASC for timeline rendering so re-sort here.
        // Using a stable copy so we don't mutate the repo's return value.
        const ascEvents = [...events].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        // pr-opened metadata carries the branch (see pr-agent.ts).
        const prOpened = ascEvents.find((e) => e.eventType === 'pr-opened');
        const branch = prOpened && typeof prOpened.metadata['branch'] === 'string'
          ? (prOpened.metadata['branch'] as string)
          : null;

        // Pull the canonical pr/run/deployment URLs from the events
        // that own each. They may legitimately appear later than
        // pr-opened (deploymentUrl lives on the staging/production
        // promotion events).
        const eventByType = (type: DeploymentEventRecord['eventType']) =>
          ascEvents.find((e) => e.eventType === type) ?? null;

        const prUrl = prOpened?.prUrl ?? null;
        const prNumber = prOpened?.prNumber ?? null;
        const pipelineEvent = eventByType('pipeline-passed') ?? eventByType('pipeline-triggered') ?? eventByType('pipeline-failed');
        const runId = pipelineEvent?.runId ?? null;
        const stagingPromotion = eventByType('promoted-staging');
        const productionPromotion = eventByType('promoted-production');
        const deploymentUrl =
          productionPromotion?.deploymentUrl
          ?? stagingPromotion?.deploymentUrl
          ?? null;

        const startedAt = ascEvents[0]!.createdAt.toISOString();
        const completedAt = intent.status === 'deployed' && ascEvents.length
          ? ascEvents[ascEvents.length - 1]!.createdAt.toISOString()
          : null;

        summaries.push({
          intentId: intent.id,
          correlationId: intent.correlationId,
          intentText: intent.text,
          status: intent.status,
          events: ascEvents,
          prUrl,
          prNumber,
          branch,
          runId,
          deploymentUrl,
          startedAt,
          completedAt,
        });
      }));

      // Maintain the "newest first" order after the parallel fetches.
      summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      return reply.send({ data: summaries });
    },
  );
}
