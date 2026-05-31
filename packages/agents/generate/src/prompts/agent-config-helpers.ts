/**
 * Shared helpers for injecting per-agent persona + prompt extensions
 * into every prompt builder's output (Step 1 of agent externalisation).
 *
 * Design choice: the existing prompt body in each builder stays
 * intact. We prepend a small persona block built from `agentConfig`
 * and append the operator-supplied `promptExtensions` near the very
 * end. This:
 *
 *   - keeps every existing structural assertion (file paths, JSON
 *     output shapes, etc.) in the prompt's body where the model has
 *     always seen them
 *   - makes the persona override visible at the top of every
 *     execution log (operators eyeballing the dashboard's prompt
 *     panel see what role the agent is playing)
 *   - puts project-specific extensions ABOVE the closing JSON-only
 *     output reminder so the model treats them as standing
 *     instructions, not asides
 */

import type { AgentConfig } from '../types';

/**
 * Wraps the prompt builder's natural body with a persona line at the
 * top and a "Project-specific instructions" block at the bottom (if
 * the project has any).
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
