-- Migration 022: project Git PAT may reference a vault secret
--
-- Until now, project Git credentials lived as plain text in the
-- `project_git_credentials` table. This migration lets a project
-- instead reference a row in `platform_secrets` (encrypted at rest
-- under the master key). When `git_secret_id` is set, it takes
-- precedence over the plain-text token — see
-- `BaseOrchestrator.resolveProjectCredential` in core. The plain
-- token path is preserved for backward compatibility with projects
-- created before this migration.
--
-- ON DELETE SET NULL so removing a secret never breaks a project —
-- the orchestrator falls back to the plain-token path (or surfaces
-- a clean "no credential" error if neither is present).
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS git_secret_id UUID
    REFERENCES platform_secrets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_git_secret_id
  ON projects(git_secret_id) WHERE git_secret_id IS NOT NULL;
