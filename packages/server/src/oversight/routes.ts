/**
 * Oversight routes — alerts, interventions, and live event stream.
 * These are the server endpoints that the dashboard consumes.
 *
 * Routes:
 *   GET  /alerts               — list alerts (filterable)
 *   GET  /alerts/:id           — get alert detail
 *   POST /interventions        — submit a human intervention
 *   GET  /events               — SSE stream of live platform events
 *   GET  /maintenance/runs     — list maintenance agent runs
 *   POST /maintenance/trigger  — manually trigger a maintenance agent (admin only)
 */

import type { FastifyInstance } from 'fastify';
import type { InterventionRequest } from './types';

/**
 * Registers all oversight routes on the Fastify instance.
 * Full implementation: Phase 2.
 */
export async function registerOversightRoutes(app: FastifyInstance): Promise<void> {

  // GET /alerts
  app.get('/alerts', async (_req, _reply) => {
    throw new Error('GET /alerts not yet implemented');
  });

  // GET /alerts/:id
  app.get('/alerts/:id', async (_req, _reply) => {
    throw new Error('GET /alerts/:id not yet implemented');
  });

  // POST /interventions
  app.post<{ Body: InterventionRequest }>('/interventions', async (_req, _reply) => {
    throw new Error('POST /interventions not yet implemented');
    // Phase 2:
    // 1. Validate intervention type and payload
    // 2. Write InterventionRecord to audit log (GP-002)
    // 3. Route to appropriate handler:
    //    - approve/reject-promotion → promotion-agent queue
    //    - provide-clarification → resume intent cycle with clarification
    //    - acknowledge-breach → resume or abort intent cycle
    // 4. Emit live event: 'alert.acknowledged'
  });

  // GET /events — Server-Sent Events stream
  app.get('/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    // Phase 2: subscribe to platform event bus and stream to client
    // const unsubscribe = eventBus.subscribe((event) => {
    //   reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    // });

    req.raw.on('close', () => {
      // unsubscribe();
      reply.raw.end();
    });

    // Keep-alive ping every 30 seconds
    const ping = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 30_000);

    req.raw.on('close', () => clearInterval(ping));
  });

  // GET /maintenance/runs
  app.get('/maintenance/runs', async (_req, _reply) => {
    throw new Error('GET /maintenance/runs not yet implemented');
  });

  // POST /maintenance/trigger
  app.post('/maintenance/trigger', async (_req, _reply) => {
    throw new Error('POST /maintenance/trigger not yet implemented');
  });
}

// ─── Types used by oversight routes ──────────────────────────────────────────

export interface InterventionRequest {
  alertId: string;
  correlationId: string;
  type: 'approve-promotion' | 'reject-promotion' | 'provide-clarification' | 'acknowledge-breach';
  payload: Record<string, unknown>;
}
