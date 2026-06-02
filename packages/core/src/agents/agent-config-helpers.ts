/**
 * Shared helpers for injecting per-agent persona + prompt extensions
 * into a prompt body. Used by every agent layer via `BaseLLMAgent`.
 *
 * Moved to `@gestalt/core` from `@gestalt/agents-generate` in
 * 2026-06-02. The generate package re-exports these names for
 * back-compat.
 */

import type { AgentConfig } from './agent-config';

/**
 * Wraps the prompt builder's natural body with a persona line at the
 * top and a "Project-specific instructions" block at the bottom
 * (when the operator's `prompt_extensions` array is non-empty).
 */
export function applyAgentConfig(body: string, agentConfig: AgentConfig): string {
  const persona = buildPersona(agentConfig);
  const extensions = buildExtensionsBlock(agentConfig.promptExtensions);
  return `${persona}\n${body}${extensions}`;
}

export function buildPersona(agentConfig: AgentConfig): string {
  return `You are ${agentConfig.role} working on the Gestalt platform.\nYour goal: ${agentConfig.goal}\n`;
}

export function buildExtensionsBlock(extensions: string[]): string {
  if (!extensions || extensions.length === 0) return '';
  return `\n\n## Project-specific instructions\n\n${extensions.map((e) => `- ${e}`).join('\n')}\n`;
}
