-- 013_auto_merge.sql — Add 'auto-merged' to deployment_event_type
--
-- Companion to the PipelineAdapter.mergePullRequest method. When
-- HARNESS.json has `pipeline.autoMerge: true`, the promotion-agent
-- calls adapter.mergePullRequest after staging promotion succeeds
-- and persists one of these rows via deployment_events.append.
--
-- Idempotent via ADD VALUE IF NOT EXISTS — safe to re-run on any
-- deployment, and safe for fresh installs that have not run this
-- migration before.
--
-- This is pure schema only — the migration runner owns
-- `schema_migrations` writes.

ALTER TYPE deployment_event_type ADD VALUE IF NOT EXISTS 'auto-merged';
