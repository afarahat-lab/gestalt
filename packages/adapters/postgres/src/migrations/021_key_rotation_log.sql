-- Migration 021: master key rotation log
--
-- Records every successful master-key rotation so operators can audit
-- when keys were last rotated and by whom. The rotation itself
-- happens via `POST /platform/secrets/rotate-key` — an atomic
-- transaction that re-encrypts every row in `platform_secrets` under
-- the new key. This table stores only the metadata of each
-- successful rotation; the keys themselves NEVER touch the database.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

CREATE TABLE IF NOT EXISTS platform_key_rotations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotated_by   UUID REFERENCES users(id),
  secret_count INTEGER NOT NULL,
  rotated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_key_rotations_rotated_at
  ON platform_key_rotations(rotated_at DESC);
