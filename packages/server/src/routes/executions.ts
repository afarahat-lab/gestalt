/**
 * Execution routes.
 *
 *   GET /executions/:id/log — the persisted prompt + LLM response +
 *                             outcome of a single agent run, plus the
 *                             execution row itself, the artifacts
 *                             produced by that agent for the
 *                             correlation, and the signals it emitted.
 *
 * The dashboard's IntentDetail accordion calls this when the operator
 * clicks an execution row open. Older executions (pre-migration 007)
 * have no log row — we return a 200 with `log: null` rather than 404
 * so the dashboard can render a "log not available" placeholder
 * without distinguishing the "intent doesn't exist" case from
 * "intent exists but the run predates execution-log capture".
 */

import type { FastifyInstance } from 'fastify';
import { getRepositories } from '@gestalt/core';
import { requireRole, checkProjectMembership } from '../auth/middleware';

export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Params: { id: string } }>(
    '/executions/:id/log',
    { preHandler: requireRole('viewer') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { executions, executionLogs, artifacts, signals, intents } = getRepositories();

      const execution = await executions.findById(request.params.id);
      if (!execution) {
        return reply.code(404).send({ error: 'Execution not found' });
      }

      // Resolve membership through correlationId → intent → projectId.
      // A user who can't see the project can't read its execution logs
      // (the prompts + LLM responses are not for cross-project eyes).
      const intent = await intents.findByCorrelationId(execution.correlationId);
      if (intent) {
        if (!await checkProjectMembership(reply, request.user.id, request.user.role, intent.projectId)) return;
      }

      const log = await executionLogs.findByExecutionId(execution.id);

      // Artifacts + signals are stored against the correlationId and
      // tagged with which agent produced / emitted them. Filter
      // down to just this execution's agent — every other agent's
      // output lives in a different execution's log.
      const [allArtifacts, allSignals] = await Promise.all([
        artifacts.findByCorrelationId(execution.correlationId),
        signals.findByCorrelationId(execution.correlationId),
      ]);
      const myArtifacts = allArtifacts.filter((a) => a.producedBy === execution.agentRole);
      const mySignals = allSignals.filter((s) => s.sourceAgent === execution.agentRole);

      return reply.send({
        data: {
          execution,
          log,        // null for pre-migration-007 runs
          artifacts: myArtifacts,
          signals: mySignals,
        },
      });
    },
  );
}
