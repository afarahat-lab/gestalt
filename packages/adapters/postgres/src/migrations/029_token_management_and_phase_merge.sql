-- Migration 029: TR_035 / ADR-057 — two surgical column additions.
--
-- 1. agent_execution_logs.token_management (JSONB)
--    Per-call telemetry from BaseLLMAgent's five-layer token
--    management pipeline. Schema (see TokenManagementLog in
--    @gestalt/core/agents/base-llm-agent):
--      {
--        "originalPromptTokens": int,
--        "finalPromptTokens": int,
--        "reductionStrategy": "phase-history-summarisation"
--                          | "rules-compression"
--                          | "architecture-trim"
--                          | null,
--        "budgetExpansions": int,
--        "finalMaxTokens": int,
--        "truncationOccurred": bool
--      }
--    NULL on legacy rows + on tool-loop calls where only the final
--    turn's telemetry is captured.
--
-- 2. feature_phases.merge_commit_sha (TEXT)
--    TR_035 Part B2 — when an auto-merged PR closes, the
--    promotion-agent records the squash-merge commit SHA so the
--    phase-evaluator can run `git show --name-only --format= <sha>`
--    to enumerate files written in this phase exactly. Falls back
--    gracefully to the existing `git diff origin/<default>` path
--    when NULL (NoOpPipelineAdapter never sets this).
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE agent_execution_logs
  ADD COLUMN IF NOT EXISTS token_management JSONB;

ALTER TABLE feature_phases
  ADD COLUMN IF NOT EXISTS merge_commit_sha TEXT;
