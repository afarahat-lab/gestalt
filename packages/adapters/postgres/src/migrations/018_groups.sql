-- 018_groups.sql — Platform groups (Brief 1 — bulk user management).
--
-- A group has members (users) and project assignments (project + role).
-- When a user joins a group, they get implicit access to every project
-- the group is assigned to. When the group is assigned to a project,
-- all current members get implicit access. The effective role on a
-- project is the maximum of the user's direct membership role (from
-- migration 010 `project_memberships`) and any group-derived roles.
--
-- ON DELETE CASCADE: deleting a group removes its memberships and
-- project assignments automatically. Direct `project_memberships`
-- rows are NEVER touched — direct membership is independent from
-- group-derived access.
--
-- Pure schema only — the migration runner owns `schema_migrations`.

CREATE TABLE platform_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_memberships (
  group_id  UUID NOT NULL REFERENCES platform_groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  added_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_project_assignments (
  group_id    UUID NOT NULL REFERENCES platform_groups(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id)        ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('project-admin','editor','reader')),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, project_id)
);

-- Per-direction indexes for the effective-membership read path.
-- `getEffectiveMemberships(userId)` joins memberships → assignments
-- on group_id; the project-side lookup
-- (`whose groups are assigned to project X`) is the inverse direction.
CREATE INDEX idx_group_memberships_user    ON group_memberships(user_id);
CREATE INDEX idx_group_memberships_group   ON group_memberships(group_id);
CREATE INDEX idx_group_project_group       ON group_project_assignments(group_id);
CREATE INDEX idx_group_project_project     ON group_project_assignments(project_id);
