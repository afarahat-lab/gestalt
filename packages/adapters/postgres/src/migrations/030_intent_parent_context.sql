-- Migration 030: intents.parent_context — TR_053 amendment
--
-- The LangGraph PlanningGraph (ADR-056 Phase 2) needs to route the
-- `intent.status-changed` event back to the planning thread that
-- dispatched the phase intent. The event payload today is just
-- `{ intentId, status }`; the subscriber JOINs `feature_phases` on
-- `intent_id` to reconstruct the parent feature. The amendment moves
-- the parent context onto the intent record itself so the event
-- emitter at `transitionIntent` can include it in the event payload,
-- and the subscriber routes without a DB lookup.
--
-- Shape of `parent_context` for planner-driven phase intents:
--   {
--     "kind":       "planning-phase",
--     "featureId":  "<uuid>",
--     "phaseIndex": <number>
--   }
--
-- Other kinds may be added in future (self-healing already uses
-- `on_success_dispatch` as a separate mechanism; this column is
-- additive and not a replacement). Null on every existing intent —
-- zero behaviour change for legacy rows. JSONB shape only;
-- application code validates `kind`.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS parent_context JSONB;

-- No index — the column is read by primary-key lookups
-- (`intents.findById(intentId)`), never as a filter predicate.
