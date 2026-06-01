-- 012_tool_calls.sql
--
-- ADR-038 — Agent tool use. Adds a `tool_calls` JSONB array to
-- `agent_execution_logs` so operators can audit what files an agent
-- read before generating its output. Each entry is one
-- `ToolCallLogEntry` (toolName, input, output truncated to 500 chars,
-- isError, calledAt). Default `[]` so pre-migration rows + non-LLM
-- agents (constraint-agent, pr-agent, …) keep returning correctly
-- shaped data without backfill.

ALTER TABLE agent_execution_logs
  ADD COLUMN tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb;
