-- 019_intent_branch.sql — Intent ↔ PR/branch bookkeeping (pipeline
-- failure resume flow).
--
-- pr-agent now saves the branch + PR coordinates onto the `intents`
-- row after creating the PR; the pipeline-feedback flow reads them
-- back when an operator submits a fix so the orchestrator can resume
-- the cycle on the SAME branch (not a fresh one), and pr-agent on the
-- retry leg pushes to the existing branch without opening a new PR.
--
-- Nullable on every column — existing intents have no PR yet, and
-- intents that never reach pr-agent (failed at gate, failed before
-- deploy) keep these as NULL forever.
--
-- Pure schema only — the migration runner owns `schema_migrations`.

ALTER TABLE intents ADD COLUMN branch_name TEXT;
ALTER TABLE intents ADD COLUMN pr_number   INTEGER;
ALTER TABLE intents ADD COLUMN pr_url      TEXT;
