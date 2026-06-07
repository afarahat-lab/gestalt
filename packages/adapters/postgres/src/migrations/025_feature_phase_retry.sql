-- Migration 025: feature phase retry budget (TR_022)
--
-- A single CI failure on a planner-driven phase intent should not
-- immediately block the whole feature. The planning orchestrator
-- reads `retry_count` against the per-project
-- `HARNESS.json.planner.maxPhaseRetries` cap (default 2) and
-- re-dispatches `planning:phase` for the same phase until the budget
-- is exhausted; only then is the feature transitioned to `blocked`.
--
-- DEFAULT 0 — every existing phase row starts un-retried so the
-- semantics on the next cycle match exactly what the planner already
-- did pre-TR_022 (a single attempt). Operators who explicitly set
-- `planner.maxPhaseRetries: 0` get the old behaviour.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE feature_phases
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
