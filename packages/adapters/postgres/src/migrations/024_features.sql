-- Migration 024: features + feature_phases + feature_plan_log
--
-- Adds the planning layer's persistent state. The planning capability
-- decomposes a feature into a sequence of small, independently
-- deployable phases. Each phase is submitted to the generate layer
-- as a Gestalt intent and goes through the full SDLC chain
-- (generate → gate → deploy) before the planner submits the next.
--
-- features          — top-level user submission ("build the leave
--                     management module"). status drives the lifecycle.
-- feature_phases    — the phase plan produced by planner-agent. Each
--                     row links to the intent the orchestrator
--                     dispatched for that phase. result captures the
--                     phase-evaluator-agent's verdict + adjustments.
-- feature_plan_log  — append-only event log for operator visibility.
--                     One row per: architecture-designed, plan-built,
--                     phase-submitted, phase-deployed, phase-evaluated,
--                     plan-adjusted, feature-completed, feature-failed.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

CREATE TABLE features (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'planning'
                CHECK (status IN (
                  'planning','in-progress','completed','blocked','cancelled'
                )),
  architecture  TEXT,
  phase_count   INTEGER NOT NULL DEFAULT 0,
  current_phase INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_features_project_id ON features(project_id);
CREATE INDEX idx_features_status     ON features(status);

CREATE TABLE feature_phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id    UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  phase_index   INTEGER NOT NULL,
  title         TEXT NOT NULL,
  scope         TEXT NOT NULL,
  architecture  TEXT,
  dependencies  TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN (
                  'pending','in-progress','deployed','failed','skipped'
                )),
  intent_id     UUID REFERENCES intents(id),
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feature_id, phase_index)
);

CREATE INDEX idx_feature_phases_feature_id ON feature_phases(feature_id);
CREATE INDEX idx_feature_phases_intent_id  ON feature_phases(intent_id);
CREATE INDEX idx_feature_phases_status     ON feature_phases(status);

CREATE TABLE feature_plan_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id    UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  phase_index   INTEGER,
  event_type    TEXT NOT NULL,
  summary       TEXT NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feature_plan_log_feature_id ON feature_plan_log(feature_id);
CREATE INDEX idx_feature_plan_log_created_at ON feature_plan_log(created_at);
