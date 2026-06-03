-- 016_relax_llm_apikey_env.sql — Allow `platform_llms.api_key_env` to be NULL
-- so that LLM rows referencing a vault `secret_id` (Session 4 — migration 015)
-- can drop the legacy env-var pointer entirely.
--
-- The application-layer validator (`POST/PATCH /platform/llms`) enforces
-- that at least one of `apiKeyEnv` or `secretId` is set — the schema
-- relaxation alone does not allow a row with both NULL.
--
-- Pure schema only — the migration runner owns `schema_migrations`.

ALTER TABLE platform_llms
  ALTER COLUMN api_key_env DROP NOT NULL;
