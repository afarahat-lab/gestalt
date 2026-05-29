-- Migration 004: Deployment events (ADR-033, ADR-034)
-- Append-only log of every PR / pipeline / promotion event triggered by
-- the deploy layer. Mirrors the audit_log shape: writes only, no UPDATE /
-- DELETE allowed at the application layer.

CREATE TYPE deployment_event_type AS ENUM (
  'pr-opened',
  'pipeline-triggered',
  'pipeline-passed',
  'pipeline-failed',
  'promoted-staging',
  'promoted-production'
);

CREATE TABLE deployment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL,
  intent_id       UUID NOT NULL REFERENCES intents(id),
  event_type      deployment_event_type NOT NULL,
  environment     TEXT,
  pr_url          TEXT,
  pr_number       INTEGER,
  run_id          TEXT,
  deployment_url  TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployment_events_correlation ON deployment_events(correlation_id);
CREATE INDEX idx_deployment_events_intent      ON deployment_events(intent_id);
CREATE INDEX idx_deployment_events_type        ON deployment_events(event_type);

-- Append-only at the application layer. Same pattern as audit_log; uses
-- current_user + a DO block so it survives whatever role POSTGRES_USER
-- resolves to at deployment time (see 001_initial.sql for the precedent).
DO $$
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON deployment_events FROM %I', current_user);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;
