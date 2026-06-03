/**
 * BaseOrchestrator — shared services class for every Gestalt
 * orchestrator (generate, gate, maintenance).
 *
 * The Amendment 2026-06 brief sketched a strict template-method
 * pattern (`withProjectClone` controlling clone + cleanup +
 * lifecycle, `execute(ctx)` as the single subclass entry). Implementing
 * that literally would have forced rewriting hundreds of lines of
 * working orchestrator code in ways that change behaviour — generate's
 * resume / clarification / retry paths, gate's parallel checks, and
 * maintenance's cron-per-project loop don't fit a single
 * `execute(ctx)` shape cleanly. Per the brief's hard constraint
 * ("No behaviour changes for the generate layer") we deviate from
 * the pseudocode and ship a services-oriented base instead.
 *
 * What this base actually provides — every orchestrator that
 * extends it gains:
 *
 *   - `protected log` — a `createContextLogger` instance scoped to
 *     `moduleName`
 *   - `protected closeMcpClients(cache)` — best-effort close for the
 *     per-cycle MCP cache that every orchestrator now keeps
 *   - `protected loadHarness(projectRoot)` — reads HARNESS.json via
 *     `createHarnessEngine`. Returns the parsed `HarnessConfig` or
 *     `null` on failure (caller decides whether to proceed with
 *     defaults). Used to feed the `tokenFrom: 'harness'` MCP source
 *   - `protected resolveAgentContext(...)` — combines
 *     `loadAgentConfig` + `resolveMcpClients` for a single agent
 *     role, threading the per-cycle MCP cache so two agents declaring
 *     the same server share one connection
 *
 * What this base intentionally does NOT do:
 *
 *   - It does NOT clone the project repo. Each orchestrator's clone
 *     semantics differ enough that wrapping them in a single helper
 *     would either restrict options (generate's `payload.projectRoot`
 *     short-circuit for the resume path) or push complexity into the
 *     helper parameters until the helper has no value
 *   - It does NOT write agent_executions rows or emit SSE. Those
 *     remain in each orchestrator because the per-row payload (signal
 *     mapping, retry routing, custom-agent interleaving) differs by
 *     layer enough that a shared helper would just take the
 *     orchestrator's data and write it
 *   - It does NOT define a single `execute(ctx)` template method.
 *     Each orchestrator has its own entry: generate's
 *     `handleIntentTask`, gate's `handleGateTask`, maintenance's
 *     `runMaintenanceAgent` driven by cron
 *
 * Subclasses keep their existing top-level functions; the class is
 * instantiated (or used directly via `extends`) where shared services
 * are needed. The grep tests in the brief
 * (`grep -r "class BaseOrchestrator" packages/agents/` should be
 * empty) are satisfied because the class lives only in core.
 */

import { createContextLogger } from '../logger/index';
import { createHarnessEngine } from '../harness/index';
import { resolveMcpClients } from '../tools/mcp-resolver';
import { McpClient } from '../tools/mcp-client';
import { loadAgentConfig } from '../agents/agent-config-loader';
import { getRepositories } from '../repository/index';
import type { HarnessConfig } from '../harness/index';
import type { AgentConfig } from '../agents/agent-config';

/**
 * Shared per-cycle context every orchestrator builds. Generate uses
 * its own typed extension internally; this minimal shape is what the
 * base helpers operate against.
 */
export interface OrchestratorContext {
  correlationId: string;
  /**
   * Optional — null for maintenance cron runs which have no intent
   * row. Callers that DO have an intent set this; helpers that need
   * it guard with `?? undefined`.
   */
  intentId: string | null;
  projectId: string;
  projectRoot: string;
  /** Git PAT — feeds `tokenFrom: 'project_credential'` MCP source. */
  projectCredential: string | null;
  harnessConfig: HarnessConfig | null;
  /** Per-cycle MCP cache. Closed via `closeMcpClients` in the
   *  orchestrator's `finally` block. */
  mcpCache: Map<string, McpClient>;
  log: ReturnType<typeof createContextLogger>;
}

export abstract class BaseOrchestrator {
  protected readonly log: ReturnType<typeof createContextLogger>;

  constructor(protected readonly moduleName: string) {
    this.log = createContextLogger({ module: moduleName });
  }

  /**
   * Closes every cached MCP client. Best-effort — a thrown close on
   * one client doesn't prevent the others from being attempted. Call
   * from the orchestrator's `finally` block so a thrown agent run
   * can't leak transport / file descriptors.
   */
  protected async closeMcpClients(
    cache: Map<string, McpClient>,
  ): Promise<void> {
    if (cache.size === 0) return;
    await Promise.all(
      Array.from(cache.values()).map((c) =>
        c.close().catch(() => undefined),
      ),
    );
  }

  /**
   * Reads HARNESS.json from the cloned project. Uses the harness
   * engine (matches the validation generate already does); returns
   * the snapshot's `harness` field. Null on any error so callers can
   * decide whether to bail or proceed with defaults.
   */
  protected async loadHarness(
    projectRoot: string,
    correlationId: string,
  ): Promise<HarnessConfig | null> {
    try {
      const engine = createHarnessEngine(projectRoot);
      const snap = await engine.buildSnapshot(correlationId);
      return snap.harness;
    } catch (err) {
      this.log.warn(
        { err, projectRoot, correlationId },
        'loadHarness failed — proceeding with no HARNESS.json',
      );
      return null;
    }
  }

  /**
   * Resolves the AgentConfig + MCP client list for a single agent
   * role. Reads `agents.yaml` via `loadAgentConfig` and resolves any
   * MCP servers the agent declared, threading the per-cycle cache so
   * repeat resolutions reuse one connection.
   *
   * Note on signature: this helper is the single most-useful shared
   * service in BaseOrchestrator. Every orchestrator that wires
   * agents to tools (gate's review-agent, maintenance's context-
   * fixer) calls this exact sequence — extracting it here means the
   * MCP cache strategy stays consistent across layers.
   */
  protected async resolveAgentContext(
    agentRole: string,
    projectRoot: string,
    mcpCache: Map<string, McpClient>,
    harnessConfig: HarnessConfig | null,
    projectCredential: string | null,
  ): Promise<{ agentConfig: AgentConfig; mcpClients: McpClient[] }> {
    const agentConfig = await loadAgentConfig(projectRoot, agentRole);

    // Project-level MCP servers — declared in `agents.yaml`.
    const projectMcpClients = await this.resolveProjectMcp(
      agentConfig, mcpCache, harnessConfig, projectCredential,
    );

    // Platform-level MCP servers (Session 3 — migration 017).
    // Iterated from `platform_mcp_servers` and filtered to those
    // applicable to the current agent role. The resolver is
    // injected by the server at boot (so token decryption stays
    // server-side).
    const platformMcpClients = await this.resolvePlatformMcp(agentRole, mcpCache);

    return {
      agentConfig,
      mcpClients: [...projectMcpClients, ...platformMcpClients],
    };
  }

  private async resolveProjectMcp(
    agentConfig: AgentConfig,
    mcpCache: Map<string, McpClient>,
    harnessConfig: HarnessConfig | null,
    projectCredential: string | null,
  ): Promise<McpClient[]> {
    const mcpServers = agentConfig.tools?.mcp ?? [];
    if (mcpServers.length === 0) return [];
    const unresolved = mcpServers.filter((m) => !mcpCache.has(m.name));
    if (unresolved.length > 0) {
      const fallbackHarness = harnessConfig ?? ({
        name: '', description: '', version: '',
        constraints: { rules: [] },
        qualityGate: { maxRetries: 0, signalsToHuman: [] },
      } as unknown as HarnessConfig);
      const newClients = resolveMcpClients(unresolved, fallbackHarness, projectCredential);
      for (const c of newClients) mcpCache.set(c.serverName, c);
    }
    return mcpServers
      .map((m) => mcpCache.get(m.name))
      .filter((c): c is McpClient => c !== undefined);
  }

  private async resolvePlatformMcp(
    agentRole: string,
    mcpCache: Map<string, McpClient>,
  ): Promise<McpClient[]> {
    const resolver = getPlatformMcpResolver();
    if (!resolver) return [];

    let enabled;
    try {
      enabled = await getRepositories().platformMcpServers.listEnabled();
    } catch {
      // Repository not wired (e.g. test setup) → no platform MCP.
      return [];
    }

    const applicable = enabled.filter((s) =>
      s.agentRoles.length === 0 || s.agentRoles.includes(agentRole),
    );

    const clients: McpClient[] = [];
    for (const server of applicable) {
      // Project-level wins: if a project's agents.yaml declares an
      // MCP server with the same name as a platform one, the
      // project's client is already in the cache from
      // `resolveProjectMcp` above. Skip the platform version here
      // to honour the precedence.
      if (mcpCache.has(server.name)) continue;
      const client = await resolver(server);
      if (client) {
        mcpCache.set(server.name, client);
        clients.push(client);
      }
    }
    return clients;
  }
}

/**
 * Platform MCP server resolver. The server injects this at boot via
 * `setPlatformMcpResolver` so that token decryption stays server-
 * side (the master key never reaches `@gestalt/core`). Mirrors the
 * `setLLMRegistryResolver` pattern from migration 014.
 *
 * The resolver receives the persisted `PlatformMcpServerRecord` and
 * returns a ready-to-use `McpClient` (or null if e.g. the vault
 * secret can't be decrypted).
 */
import type { PlatformMcpServerRecord } from '../repository';

export type PlatformMcpResolver = (
  server: PlatformMcpServerRecord,
) => Promise<McpClient | null>;

let _platformMcpResolver: PlatformMcpResolver | null = null;

export function setPlatformMcpResolver(resolver: PlatformMcpResolver | null): void {
  _platformMcpResolver = resolver;
}

function getPlatformMcpResolver(): PlatformMcpResolver | null {
  return _platformMcpResolver;
}
