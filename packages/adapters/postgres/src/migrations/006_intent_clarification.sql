-- Migration 006: Persist operator clarification on the intents row.
--
-- The clarification flow (2026-05-31 session) threaded clarification
-- text through the BullMQ payload, which the orchestrator dropped on a
-- gate retry — the intent-agent then re-ran without the operator's
-- input and re-paused the cycle. Persisting the text makes the DB the
-- source of truth, which survives every retry leg.
--
-- Nullable on purpose: existing intent rows pre-date this column, and
-- intents that never paused for clarification keep NULL forever. The
-- orchestrator reads `clarification ?? null` and only appends a
-- prompt section when non-null.

ALTER TABLE intents ADD COLUMN clarification TEXT;
