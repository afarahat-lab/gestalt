/**
 * Agent configuration loader — re-export shim.
 *
 * The implementation moved to
 * `@gestalt/core/agents/agent-config-loader` in 2026-06 so the gate
 * and maintenance orchestrators can load configs without depending
 * on agents-generate. Existing import paths keep working through
 * this shim.
 */
export {
  loadAgentConfig,
  defaultAgentConfig,
  loadCustomAgents,
} from '@gestalt/core';
