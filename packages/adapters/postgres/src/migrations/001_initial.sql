-- Migration 001: Initial schema
-- Creates all tables required by the Gestalt platform.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Intents ──────────────────────────────────────────────────────────────────

CREATE TABLE intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL UNIQUE,
  project_id      TEXT NOT NULL,
  text            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  source          TEXT NOT NULL DEFAULT 'human',
  priority        TEXT NOT NULL DEFAULT 'normal',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_intents_project_id    ON intents(project_id);
CREATE INDEX idx_intents_status        ON intents(status);
CREATE INDEX idx_intents_correlation   ON intents(correlation_id);

-- ─── Agent executions ────────────────────────────────────────────────────────

CREATE TABLE agent_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL,
  intent_id       UUID NOT NULL REFERENCES intents(id),
  agent_role      TEXT NOT NULL,
  task_type       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_executions_correlation ON agent_executions(correlation_id);
CREATE INDEX idx_executions_intent_id   ON agent_executions(intent_id);
CREATE INDEX idx_executions_status      ON agent_executions(status);

-- ─── Artifacts ────────────────────────────────────────────────────────────────

CREATE TABLE artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL,
  type            TEXT NOT NULL,
  path            TEXT NOT NULL,
  content         TEXT NOT NULL,
  produced_by     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_correlation ON artifacts(correlation_id);
CREATE INDEX idx_artifacts_type        ON artifacts(type);

-- ─── Signals ──────────────────────────────────────────────────────────────────

CREATE TABLE signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  source_agent    TEXT NOT NULL,
  message         TEXT NOT NULL,
  location        JSONB,
  auto_resolvable BOOLEAN NOT NULL DEFAULT true,
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_correlation ON signals(correlation_id);
CREATE INDEX idx_signals_type        ON signals(type);
CREATE INDEX idx_signals_resolved    ON signals(resolved_at) WHERE resolved_at IS NULL;

-- ─── Audit log (GP-002 — immutable, no UPDATE or DELETE) ─────────────────────

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  correlation_id  UUID NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log is append-only — revoke UPDATE and DELETE from the connecting
-- application role. Uses current_user so this works regardless of the
-- POSTGRES_USER chosen at deployment.
DO $$
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON audit_log FROM %I', current_user);
EXCEPTION WHEN OTHERS THEN
  -- Role does not exist or already lacks the privilege — safe to ignore.
  NULL;
END
$$;

CREATE INDEX idx_audit_entity    ON audit_log(entity_id);
CREATE INDEX idx_audit_actor     ON audit_log(actor);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer',
  auth_provider   TEXT NOT NULL,
  idp_subject     TEXT NOT NULL,
  idp_groups      TEXT[] NOT NULL DEFAULT '{}',
  last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(idp_subject, auth_provider)
);

CREATE INDEX idx_users_email ON users(email);

-- ─── Alerts ──────────────────────────────────────────────────────────────────

CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id  UUID NOT NULL,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  required_action TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_correlation   ON alerts(correlation_id);
CREATE INDEX idx_alerts_acknowledged  ON alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

-- ─── Intervention records ─────────────────────────────────────────────────────

CREATE TABLE intervention_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alerts(id),
  correlation_id  UUID NOT NULL,
  type            TEXT NOT NULL,
  performed_by    UUID NOT NULL REFERENCES users(id),
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Maintenance runs ─────────────────────────────────────────────────────────

CREATE TABLE maintenance_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role      TEXT NOT NULL,
  status          TEXT NOT NULL,
  intents_queued  INTEGER NOT NULL DEFAULT 0,
  direct_fixes    INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Schema version ──────────────────────────────────────────────────────────
-- The `schema_migrations` table is created by the migration runner itself
-- (CREATE TABLE IF NOT EXISTS) before this file is applied, and the runner
-- records the applied version after a successful transaction. Do not create
-- or INSERT into the table from inside a migration — it conflicts.
