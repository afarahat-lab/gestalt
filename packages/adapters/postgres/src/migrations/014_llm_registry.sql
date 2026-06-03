-- 014_llm_registry.sql — Platform-wide LLM registry.
--
-- Platform-admin manages this table; every authenticated user can read
-- it (agents resolve `model` overrides through it, and the Project
-- Settings UI populates a dropdown). The actual API key VALUE is never
-- persisted — only the env var NAME (`api_key_env`). At LLM call time
-- the server reads `process.env[api_key_env]`.
--
-- The partial unique index enforces "at most one default" at the DB
-- layer; the application layer is responsible for ensuring AT LEAST
-- one default exists (the server's first-boot seed handles this).
--
-- Pure schema only — the migration runner owns `schema_migrations`.

CREATE TABLE platform_llms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  provider      TEXT NOT NULL,
  model_string  TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  api_key_env   TEXT NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_platform_llms_default
  ON platform_llms (is_default)
  WHERE is_default = TRUE;
