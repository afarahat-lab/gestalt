-- 010_user_management.sql
--
-- Two-level role model: platform roles on `users` (platform-admin | user)
-- and project roles on the new `project_memberships` table
-- (project-admin | editor | reader). Existing 'admin' users become
-- 'platform-admin'; everyone else ('operator' / 'viewer') becomes 'user'.
--
-- platform-admin bypasses every project membership check; a regular
-- 'user' only sees projects they are a member of.
--
-- Also adds `deactivated_at` to `users` so admins can soft-disable
-- accounts without losing the audit chain. The auth middleware rejects
-- any request whose user has a non-null `deactivated_at`.

-- ─── Rename existing role values ─────────────────────────────────────────────

-- The existing CHECK constraint (if any) and the column default reference
-- the old values, so drop them before remapping.
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;

UPDATE users SET role = 'platform-admin' WHERE role = 'admin';
UPDATE users SET role = 'user'           WHERE role IN ('operator', 'viewer');

-- Add a CHECK constraint for the new role values
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('platform-admin', 'user'));

-- New default for future inserts that omit the role column
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- ─── Deactivation column ─────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMPTZ;

-- ─── Project memberships ────────────────────────────────────────────────────

CREATE TABLE project_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('project-admin', 'editor', 'reader')),
  assigned_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, project_id)
);

CREATE INDEX idx_memberships_user    ON project_memberships(user_id);
CREATE INDEX idx_memberships_project ON project_memberships(project_id);

-- ─── Backfill memberships for existing projects ─────────────────────────────
--
-- Every previously-registered project predates the membership model. We
-- mirror the previous "every authenticated user sees every project"
-- behaviour for the existing rows by auto-assigning the project's
-- `created_by` as project-admin. New projects (post-deploy) go through
-- the route-level auto-assign — see `POST /projects` in routes/projects.ts.
--
-- Without this backfill, an operator who registered a project under the
-- previous model would suddenly lose access to it after migration 010.
INSERT INTO project_memberships (user_id, project_id, role, assigned_by)
SELECT created_by, id, 'project-admin', created_by
FROM projects
WHERE NOT EXISTS (
  SELECT 1 FROM project_memberships m
  WHERE m.user_id = projects.created_by AND m.project_id = projects.id
);
