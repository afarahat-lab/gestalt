-- 011_interventions.sql
--
-- Persisted record of every operator intervention on an escalated
-- intent. Producer: `POST /interventions` (see routes/interventions.ts).
-- One row per intervention; the four typed `action` values come from
-- ADR-021. `notes` is non-null only for `acknowledge-breach` (required)
-- and `request-clarification` (optional). The notes content lives here
-- and is auditable via direct DB query; the audit_log row records only
-- the length (GP-006).

CREATE TABLE interventions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id   UUID NOT NULL,
  intent_id        UUID NOT NULL REFERENCES intents(id),
  alert_id         UUID REFERENCES alerts(id),
  action           TEXT NOT NULL CHECK (action IN (
                     'resume', 'abort',
                     'acknowledge-breach', 'request-clarification'
                   )),
  actor_id         UUID NOT NULL REFERENCES users(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interventions_intent      ON interventions(intent_id);
CREATE INDEX idx_interventions_correlation ON interventions(correlation_id);
