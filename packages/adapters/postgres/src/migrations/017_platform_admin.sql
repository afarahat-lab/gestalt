-- 017_platform_admin.sql — Platform Admin extras (Session 3 — templates,
-- platform MCP servers, identity config in DB, role mappings).
--
-- Four tables:
--   platform_templates       — harness templates (seeded at boot + custom uploads)
--   platform_mcp_servers     — platform-wide MCP servers merged into BaseOrchestrator
--   platform_identity_config — one row per provider (kerberos/saml/oidc)
--   platform_role_mappings   — IdP group → platform role
--
-- Sensitive identity fields (cert / clientSecret / keytabContent) are
-- stored as `secret_id` references into `platform_secrets` (migration
-- 015), NEVER inline in the `config` JSONB. The route layer enforces
-- this when persisting; `loadAuthConfig` resolves them at read time.
--
-- Pure schema only — the migration runner owns `schema_migrations`.

CREATE TABLE platform_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  tier         TEXT NOT NULL DEFAULT 'custom',
  version      TEXT NOT NULL DEFAULT '0.1.0',
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  is_builtin   BOOLEAN NOT NULL DEFAULT FALSE,
  files        JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "At most one default" — same partial-unique-index pattern
-- migration 014 used for platform_llms.is_default.
CREATE UNIQUE INDEX idx_platform_templates_default
  ON platform_templates(is_default) WHERE is_default = TRUE;

CREATE TABLE platform_mcp_servers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL,
  description  TEXT,
  secret_id    UUID REFERENCES platform_secrets(id) ON DELETE SET NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  agent_roles  TEXT[] NOT NULL DEFAULT '{}',
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The orchestrator queries by `enabled = TRUE` on every cycle;
-- a partial index keeps the lookup tight.
CREATE INDEX idx_platform_mcp_servers_enabled
  ON platform_mcp_servers(enabled) WHERE enabled = TRUE;

CREATE TABLE platform_identity_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL UNIQUE CHECK (provider IN ('kerberos','saml','oidc')),
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_role_mappings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name    TEXT NOT NULL UNIQUE,
  platform_role TEXT NOT NULL CHECK (platform_role IN ('platform-admin','user')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
