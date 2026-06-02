/**
 * MCP (Model Context Protocol) client (ADR-039).
 *
 * Thin wrapper around `@modelcontextprotocol/sdk` that exposes the
 * subset of MCP a Gestalt agent needs: list tools, call one. The
 * client is single-cycle scoped — `BaseLLMAgent.callLLMWithTools`
 * creates one connection at the start of a run, uses it through the
 * tool-use loop, and disconnects when the agent completes.
 *
 * Two transports supported today:
 *   - HTTP / SSE — for hosted MCP servers (e.g. GitHub's mcp.github.com,
 *     Atlassian's mcp.atlassian.com). The SDK auto-detects which
 *     server-side protocol the URL speaks (Streamable HTTP or
 *     legacy SSE). The MCP-spec name is "Streamable HTTP transport"
 *     — `StreamableHTTPClientTransport` for modern servers, falling
 *     back to `SSEClientTransport` (deprecated but still common) for
 *     older ones
 *   - stdio — for locally-spawned MCP servers (`npx @modelcontextprotocol/
 *     server-filesystem ...`). When the URL looks like `stdio:<binary>
 *     <arg1> <arg2>...`, the client spawns the child process and speaks
 *     JSON-RPC over its stdin/stdout
 *
 * The SDK is ESM-only (`"type": "module"` in its package.json) but
 * `@gestalt/core` builds CJS. All SDK imports go through dynamic
 * `import()` so the CJS build doesn't break — same pattern
 * `file-tools.ts` uses for `globby`.
 *
 * Failure mode: any thrown error from the SDK is caught at the
 * method boundary and returned as `[]` (for `listTools`) or
 * `isError: true` (for `executeTool`). MCP unavailability should
 * never abort an agent cycle — the model degrades to the tools that
 * resolved and continues.
 */

import type { ToolDefinition, ToolResult } from '../types';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'mcp-client' });

/**
 * `Client` from the MCP SDK. Untyped here because we dynamic-import
 * the module and want to avoid pulling its type names into the
 * compiled CJS surface (they would bleed into every consumer's
 * declaration tree). Functionally typed by the `executeTool` /
 * `listTools` signatures below.
 */
type SdkClient = {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  listTools: () => Promise<{ tools: Array<{ name: string; description?: string; inputSchema: unknown }> }>;
  callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<{
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

export class McpClient {
  readonly serverName: string;
  private readonly url: string;
  private readonly token: string | undefined;
  private client: SdkClient | null = null;

  constructor(serverName: string, url: string, token?: string) {
    this.serverName = serverName;
    this.url = url;
    this.token = token;
  }

  /**
   * Fetches the server's tool list and rewrites each definition into
   * the platform's `ToolDefinition` shape. Tool names are
   * namespaced `<serverName>__<toolName>` so the LLM (and the
   * dispatcher in `BaseLLMAgent.callLLMWithTools`) can route by
   * prefix. Description gains a `[serverName]` prefix so the model
   * sees which integration each tool comes from.
   *
   * Empty array on any failure — callers proceed with whatever
   * tools they did resolve.
   */
  async listTools(): Promise<ToolDefinition[]> {
    try {
      const client = await this.connect();
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: `${this.serverName}__${t.name}`,
        description: `[${this.serverName}] ${t.description ?? ''}`.trim(),
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
          type: 'object',
          properties: {},
        },
      }));
    } catch (err) {
      log.warn(
        { server: this.serverName, url: this.url, err: errMessage(err) },
        'MCP listTools failed — agent proceeds without this server',
      );
      return [];
    }
  }

  /**
   * Executes one tool call against the MCP server. `toolName` is
   * the namespaced form (`<serverName>__<realName>`) — the prefix
   * is stripped before the SDK call.
   *
   * Returns an `isError: true` ToolResult on any failure so the
   * LLM can react (and pick a different tool, or give up) without
   * the orchestrator having to translate exceptions into model-
   * visible text.
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    toolCallId: string,
  ): Promise<ToolResult> {
    try {
      const client = await this.connect();
      const prefix = `${this.serverName}__`;
      const realName = toolName.startsWith(prefix)
        ? toolName.slice(prefix.length)
        : toolName;
      const result = await client.callTool({ name: realName, arguments: input });
      const content = (result.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      return {
        toolCallId,
        content,
        isError: result.isError ?? false,
      };
    } catch (err) {
      return {
        toolCallId,
        content: `MCP error (${this.serverName}): ${errMessage(err)}`,
        isError: true,
      };
    }
  }

  /**
   * Cleanly closes the MCP connection. Called from
   * `BaseLLMAgent.callLLMWithTools` in a `finally` block so a
   * thrown LLM call doesn't leak the transport.
   */
  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* best-effort */ }
      this.client = null;
    }
  }

  /**
   * Dynamic-imports the SDK and connects on first use. Reuses the
   * connection across subsequent calls within the same agent run
   * (the tool-use loop typically calls 2–4 tools).
   */
  private async connect(): Promise<SdkClient> {
    if (this.client) return this.client;

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js') as {
      Client: new (info: { name: string; version: string }, opts: Record<string, unknown>) => SdkClient;
    };

    const transport = await this.createTransport();

    const client = new Client(
      { name: 'gestalt', version: '1.0' },
      {},
    );
    await client.connect(transport);
    this.client = client;
    log.debug({ server: this.serverName }, 'MCP connected');
    return client;
  }

  /**
   * Builds the right transport for the URL scheme:
   *   - `stdio:<bin> <arg>...` → `StdioClientTransport` (spawns the
   *     child process; useful for local test servers via npx)
   *   - `http(s)://...` → `StreamableHTTPClientTransport` first
   *     (the MCP-spec name for the modern HTTP+SSE flow); SSE-only
   *     servers will fall back at the protocol layer via the SDK's
   *     automatic detection
   */
  private async createTransport(): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    if (this.url.startsWith('stdio:')) {
      const cmd = this.url.slice('stdio:'.length).trim();
      const parts = cmd.split(/\s+/);
      const command = parts[0] ?? '';
      const args = parts.slice(1);
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js') as {
        StdioClientTransport: new (params: { command: string; args?: string[] }) => unknown;
      };
      return new StdioClientTransport({ command, args });
    }

    const url = new URL(this.url);
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js') as {
      StreamableHTTPClientTransport: new (url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) => unknown;
    };
    return new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
