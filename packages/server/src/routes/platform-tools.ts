/**
 * Platform tools route (Session 3 — read-only, no migration).
 *
 *   GET /platform/tools — any authenticated user
 *
 * Returns the four built-in file tools shipped with the platform
 * alongside the list of agents that have each tool enabled by
 * default. The response is computed from `FILE_TOOL_DEFINITIONS`
 * + `PER_ROLE_DEFAULTS` in `@gestalt/core` — no DB hit, no
 * migration. Operators tune the per-agent tool sets via
 * `agents.yaml`; this view documents the defaults so the dashboard
 * doesn't have to duplicate them.
 *
 * To add MCP tools (server-issued, dynamic), configure
 * `/platform/mcp-servers` instead — the Tools tab in the dashboard
 * points operators there.
 */

import type { FastifyInstance } from 'fastify';
import {
  FILE_TOOL_DEFINITIONS, PER_ROLE_DEFAULTS,
  type BuiltInToolName,
} from '@gestalt/core';

export async function registerPlatformToolsRoutes(app: FastifyInstance): Promise<void> {

  app.get('/platform/tools', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

    // Build a `toolName → defaultAgents[]` index once per request.
    // The defaults table is small (single-digit agents) so this is
    // cheap, and keeping it route-local means future role-defaults
    // changes don't require a parallel data structure.
    const toolToAgents: Record<string, string[]> = {};
    for (const [agentRole, config] of Object.entries(PER_ROLE_DEFAULTS)) {
      const builtin = config.tools?.builtin ?? [];
      for (const tool of builtin) {
        const list = toolToAgents[tool] ?? [];
        list.push(agentRole);
        toolToAgents[tool] = list;
      }
    }

    const data = FILE_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      defaultAgents: toolToAgents[tool.name as BuiltInToolName] ?? [],
    }));

    return reply.send({ data });
  });
}
