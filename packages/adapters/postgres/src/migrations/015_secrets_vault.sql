-- 015_secrets_vault.sql — Encrypted platform secrets store.
--
-- Replaces the apiKeyEnv pattern as the primary mechanism for
-- storing LLM API keys. The actual key VALUE is encrypted with
-- AES-256-GCM under a server-side master key (loaded from env var
-- GESTALT_MASTER_KEY, or /etc/gestalt/master.key, or auto-generated
-- in dev).
--
-- The `encrypted`, `iv`, `auth_tag` columns are NEVER returned by
-- GET /platform/secrets — the public surface returns only the
-- summary fields (id, name, description, timestamps).
--
-- `platform_llms` gains a `secret_id` reference. When BOTH `secret_id`
-- and `api_key_env` are populated on a row, `secret_id` takes
-- precedence in `getLLMClientForModel`. The `api_key_env` column is
-- preserved for back-compat (existing deployments) and for operators
-- who prefer the env-var workflow.
--
-- Pure schema only — the migration runner owns `schema_migrations`.

CREATE TABLE platform_secrets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  encrypted    TEXT NOT NULL,
  iv           TEXT NOT NULL,
  auth_tag     TEXT NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_llms
  ADD COLUMN secret_id UUID REFERENCES platform_secrets(id) ON DELETE SET NULL;

-- Tooling index for `DELETE /platform/secrets/:id` — the SECRET_IN_USE
-- guard scans platform_llms.secret_id; a single small lookup column,
-- so a regular btree is the right choice.
CREATE INDEX idx_platform_llms_secret_id ON platform_llms (secret_id)
  WHERE secret_id IS NOT NULL;
