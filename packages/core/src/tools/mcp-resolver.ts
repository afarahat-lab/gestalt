/**
 * MCP token + client resolver (ADR-039).
 *
 * Turns an array of `McpServerConfig` (from `agents.yaml`) into a
 * matched array of ready-to-use `McpClient` instances. Resolves
 * `tokenFrom` against the three supported credential sources:
 *
 *   - `'harness'`            — `HarnessConfig.mcp.servers[]` (lookup
 *                              by matching server `name`)
 *   - `'project_credential'` — the project's Git PAT (passed in by
 *                              the orchestrator from
 *                              `projects.getCredential`)
 *   - `'env:VAR_NAME'`       — `process.env.VAR_NAME` (the only way
 *                              to keep tokens out of the project
 *                              repo)
 *
 * Missing tokens are passed to the client as `undefined`; the
 * client connects anonymously — some MCP servers don't require
 * auth, and even for ones that do, a clean "401 from the server"
 * error message is more useful to the operator than a thrown
 * exception during config resolution.
 */

import type { HarnessConfig } from '../harness/index';
import { createContextLogger } from '../logger/index';
import { McpClient } from './mcp-client';

const log = createContextLogger({ module: 'mcp-resolver' });

export interface McpServerConfig {
  name: string;
  url: string;
  tokenFrom: 'harness' | 'project_credential' | `env:${string}`;
}

export function resolveMcpClients(
  mcpConfigs: McpServerConfig[],
  harnessConfig: HarnessConfig,
  projectCredential: string | null,
): McpClient[] {
  return mcpConfigs.map((config) => {
    const token = resolveToken(config, harnessConfig, projectCredential);
    if (token === null) {
      log.debug(
        { server: config.name, tokenFrom: config.tokenFrom },
        'MCP token resolved to null — client will connect anonymously',
      );
    }
    return new McpClient(config.name, config.url, token ?? undefined);
  });
}

function resolveToken(
  config: McpServerConfig,
  harness: HarnessConfig,
  projectCredential: string | null,
): string | null {
  const source = config.tokenFrom;

  if (source === 'project_credential') {
    return projectCredential;
  }

  if (source === 'harness') {
    // Look up by server `name`, not by the `tokenFrom` string.
    return harness.mcp?.servers?.find((s) => s.name === config.name)?.token ?? null;
  }

  if (typeof source === 'string' && source.startsWith('env:')) {
    const varName = source.slice('env:'.length);
    if (!varName) return null;
    return process.env[varName] ?? null;
  }

  log.warn({ server: config.name, tokenFrom: source }, 'Unknown tokenFrom source');
  return null;
}
