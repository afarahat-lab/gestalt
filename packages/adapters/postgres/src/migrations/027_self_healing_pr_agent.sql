-- Migration 027: seed self-healing config for the PR-Agent
-- failure type — ADR-051 / TR_027.
--
-- The platform_self_healing_config table (migration 020) has a
-- UNIQUE constraint on `failure_type`; an INSERT … ON CONFLICT
-- DO NOTHING is the idempotent seed pattern the rest of the file
-- uses. Without this row the platform falls back to the hard-coded
-- DEFAULT_CONFIG (max 2 attempts, medium confidence) which would
-- work, but every other failure type has an explicit row so the
-- dashboard's `gestalt platform self-healing list` view is
-- complete.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

INSERT INTO platform_self_healing_config
  (failure_type, max_attempts, confidence_threshold, auto_resolve_alerts, enabled)
VALUES
  ('review-requested-changes', 2, 'medium', TRUE, TRUE)
ON CONFLICT (failure_type) DO NOTHING;
