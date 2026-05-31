/**
 * Status routes.
 *
 * GET /health          — liveness probe (no auth)
 * GET /status          — platform status (auth required)
 * GET /status/agents   — active agent executions
 */

import type { FastifyInstance } from 'fastify';
import { getRepositories, createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'routes:status' });

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {

  // GET /health — unauthenticated liveness probe
  app.get('/health', async (_request, reply) => {
    try {
      const { intents } = getRepositories();
      const healthy = await intents.healthCheck();
      return reply.send({
        status: healthy ? 'ok' : 'degraded',
        version: process.env['npm_package_version'] ?? '0.0.0',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Health check failed');
      return reply.code(503).send({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  // GET /status — platform overview
  app.get('/status', async (_request, reply) => {
    const { executions } = getRepositories();
    const activeAgents = await executions.findActive();

    return reply.send({
      data: {
        activeAgents: activeAgents.length,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // GET /status/agents — active agent detail
  //
  // Enriched per request brief: each row includes the intent text (so the
  // ActiveAgents card can render which cycle the agent belongs to),
  // cycle progress (completed-or-skipped vs total steps in the plan
  // so the card can show "step N of M"), and the running token total
  // across every agent in the cycle.
  //
  // De-dupes the per-correlation lookups so a cycle with 6 concurrent
  // agents triggers one `intents.findByCorrelationId` and one
  // `executions.findByCorrelationId` instead of six of each.
  app.get('/status/agents', async (_request, reply) => {
    const { executions, intents } = getRepositories();
    const active = await executions.findActive();

    // One unique correlationId may have multiple active agents; cache
    // both lookups per id.
    const uniqueCorrIds = Array.from(new Set(active.map((e) => e.correlationId)));
    const intentCache = new Map<string, string | null>();
    const cycleCache = new Map<string, Awaited<ReturnType<typeof executions.findByCorrelationId>>>();

    await Promise.all(uniqueCorrIds.map(async (id) => {
      const [intent, cycle] = await Promise.all([
        intents.findByCorrelationId(id),
        executions.findByCorrelationId(id),
      ]);
      intentCache.set(id, intent?.text ?? null);
      cycleCache.set(id, cycle);
    }));

    const enriched = active.map((exec) => {
      const cycle = cycleCache.get(exec.correlationId) ?? [];
      const completed = cycle.filter((e) => e.status === 'completed' || e.status === 'skipped').length;
      const total = cycle.length;
      const tokensSoFar = cycle.reduce((sum, e) => sum + (e.tokensUsed ?? 0), 0);
      return {
        ...exec,
        intentText: intentCache.get(exec.correlationId) ?? null,
        cycleProgress: { completed, total },
        tokensSoFar,
      };
    });

    return reply.send({ data: enriched });
  });
}
