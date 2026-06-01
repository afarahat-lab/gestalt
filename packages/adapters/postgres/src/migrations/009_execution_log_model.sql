-- 009_execution_log_model.sql
--
-- Adds `model_used` to `agent_execution_logs` so the dashboard's
-- IntentDetail accordion can show which LLM model handled each agent
-- step. Populated by the orchestrators after `LLMClient.complete()`
-- returns (the orchestrator calls `client.getModel()` to capture the
-- actual model the registry routed to).
--
-- Nullable on purpose — pre-migration rows (and non-LLM agents like
-- constraint-agent / pr-agent / pipeline-agent) leave it NULL. The
-- dashboard renders `—` in that case.

ALTER TABLE agent_execution_logs ADD COLUMN model_used TEXT;
