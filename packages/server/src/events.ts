/**
 * Re-export of the @gestalt/core event bus.
 *
 * Existing callers `import { eventBus, emitLiveEvent } from '../events'` —
 * this file preserves that path while the canonical implementation lives in
 * core (so the generate-layer orchestrator can publish on the same singleton
 * without creating an agents → server dep cycle).
 */
export { eventBus, emitLiveEvent } from '@gestalt/core';
