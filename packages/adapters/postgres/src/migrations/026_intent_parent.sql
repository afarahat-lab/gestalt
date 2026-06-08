-- Migration 026: intent parent + onSuccessDispatch — TR_024
--
-- The self-healing diagnostician (ADR-050) can now decide that a
-- failure reveals a SYSTEMIC GAP in the project (e.g. a missing
-- tsconfig flag, a missing dependency, a broken DTO) rather than
-- a local code bug. When it does, the loop submits a *fix intent*
-- as a separate high-priority generate cycle and links the two:
--
--   - `intents.parent_intent_id` → the original intent this child
--     was spawned to fix
--   - `intents.on_success_dispatch` → a JSONB envelope the
--     promotion-agent reads after production deploy and dispatches
--     verbatim onto the queue (typically a `generate:intent`
--     resume of the parent). Null on every regular intent.
--
-- Both columns are NULL on existing rows — zero behaviour change
-- for any intent that doesn't participate in the fix-intent flow.
-- The foreign key uses ON DELETE SET NULL so deleting a parent
-- intent doesn't cascade-destroy its child's audit history.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS parent_intent_id UUID
    REFERENCES intents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS on_success_dispatch JSONB;

CREATE INDEX IF NOT EXISTS idx_intents_parent_intent_id
  ON intents(parent_intent_id)
  WHERE parent_intent_id IS NOT NULL;
