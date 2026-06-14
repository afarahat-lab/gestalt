/**
 * Re-export of the process-wide LangGraph PostgreSQL checkpointer.
 * The implementation moved to `@gestalt/core` in TR_056 so quality-gate
 * (Phase 4) could share the same singleton without depending on
 * planning. This file is kept as a re-export for backward compatibility
 * with existing imports in `graphs/architecture/graph.ts` and
 * `graphs/planning/graph.ts`.
 */

export { getCheckpointer } from '@gestalt/core';
