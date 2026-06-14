/**
 * Process-wide LangGraph PostgreSQL checkpointer (TR_056 / ADR-056).
 *
 * Was previously located in `@gestalt/agents-planning/src/graphs/checkpointer.ts`
 * (TR_051 Phase 1). Moved here in TR_056 because Phase 4 (GateGraph) needs
 * the SAME `PostgresSaver` instance — one `pg.Pool` per process, not one
 * per package — and quality-gate cannot depend on planning (direction is
 * wrong).
 *
 * LangGraph 0.2 creates four tables on first `setup()` call:
 * `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`,
 * `checkpoint_migrations`. LangGraph owns its own DDL — no Gestalt
 * migration. Tables are shared across all graphs (planning, gate, …)
 * because `thread_id` is the namespace; each graph picks a thread_id
 * convention (planning = featureId; gate = correlationId).
 *
 * `setup()` is idempotent — LangGraph guards on `isSetup`.
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { loadConfig } from '../config/index';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'langgraph-checkpointer' });

let cached: PostgresSaver | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * Resolve the process-wide PostgresSaver. First caller pays the
 * `setup()` cost (LangGraph table creation + migration); subsequent
 * callers await the same promise. On setup failure the cached
 * instance is cleared so the next caller can retry.
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (cached && setupPromise) {
    await setupPromise;
    return cached;
  }
  const config = loadConfig();
  const saver = PostgresSaver.fromConnString(config.database.url);
  cached = saver;
  setupPromise = (async () => {
    try {
      await saver.setup();
      log.info('LangGraph PostgreSQL checkpointer ready');
    } catch (err) {
      cached = null;
      setupPromise = null;
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'LangGraph checkpointer setup failed',
      );
      throw err;
    }
  })();
  await setupPromise;
  return saver;
}
