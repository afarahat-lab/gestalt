-- Migration 020: autonomous self-healing
--
-- Adds `platform_self_healing_config` — platform-level defaults per
-- failure type, configurable by platform-admin from the dashboard /
-- CLI. Extends `intents` with `attempt_count` + `last_resume_context`
-- so the generate orchestrator can carry self-healing diagnosis
-- forward across retry cycles. Extends `deployment_event_type` with
-- `resume-pushed` for the timeline of self-healed cycles.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).
--
-- Seeded defaults match the brief's table — `pipeline-timeout` is
-- intentionally tighter (1 attempt, high confidence) because timeouts
-- are usually infrastructure issues the LLM can't fix.

CREATE TABLE IF NOT EXISTS platform_self_healing_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_type          TEXT NOT NULL UNIQUE,
  max_attempts          INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 0 AND max_attempts <= 10),
  confidence_threshold  TEXT NOT NULL DEFAULT 'medium'
                          CHECK (confidence_threshold IN ('high','medium','low')),
  auto_resolve_alerts   BOOLEAN NOT NULL DEFAULT TRUE,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by            UUID REFERENCES users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults for every failure type the platform recognises.
-- INSERT ... ON CONFLICT DO NOTHING is idempotent across re-runs.
INSERT INTO platform_self_healing_config
  (failure_type, max_attempts, confidence_threshold, auto_resolve_alerts, enabled)
VALUES
  ('generate-error',       2, 'medium', TRUE, TRUE),
  ('gate-max-retries',     2, 'medium', TRUE, TRUE),
  ('pipeline-failed',      2, 'medium', TRUE, TRUE),
  ('pipeline-timeout',     1, 'high',   TRUE, TRUE),
  ('deploy-error',         1, 'medium', TRUE, TRUE),
  ('maintenance-error',    1, 'medium', TRUE, TRUE),
  ('custom-agent-failure', 2, 'medium', TRUE, TRUE)
ON CONFLICT (failure_type) DO NOTHING;

-- Extend intents with self-healing bookkeeping.
-- branch_name / pr_number / pr_url were added by migration 019 — the
-- brief restates them here with IF NOT EXISTS so a fresh-install run
-- of 020 in isolation still works.
ALTER TABLE intents ADD COLUMN IF NOT EXISTS branch_name         TEXT;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS pr_number           INTEGER;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS pr_url              TEXT;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS attempt_count       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS last_resume_context JSONB;

-- New deployment event type — self-healing pushed a fix to an
-- existing branch (distinct from the resume-pushed-on-operator-
-- feedback path that ships in pipeline-feedback).
ALTER TYPE deployment_event_type ADD VALUE IF NOT EXISTS 'resume-pushed';
