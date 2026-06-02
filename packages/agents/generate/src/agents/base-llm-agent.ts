/**
 * BaseLLMAgent — re-export shim.
 *
 * The implementation moved to `@gestalt/core/agents/base-llm-agent`
 * in 2026-06 so the generate, gate, and maintenance layers all
 * extend a single class. Existing import paths
 * (`from '../agents/base-llm-agent'` and from the package's public
 * surface) keep working through this shim.
 */
export { BaseLLMAgent } from '@gestalt/core';
