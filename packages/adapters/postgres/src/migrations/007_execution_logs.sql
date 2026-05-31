-- Migration 007: Persist the prompt + LLM response + outcome of each
-- agent run so the dashboard's IntentDetail view can expand an
-- execution row into its full trail (prompt sent, response received,
-- artifacts produced, signals emitted, error if any).
--
-- One row per `agent_executions` row (1:1, enforced by the FK +
-- application code calling `save` exactly once per step). NOT a log
-- stream — incremental progress lives in the in-process event bus, this
-- table captures the post-completion snapshot.
--
-- `ON DELETE CASCADE` on `execution_id` matches the existing BullMQ
-- removeOnComplete contract: if an execution row is ever cleaned up,
-- its log goes with it.

CREATE TABLE agent_execution_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id    UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  correlation_id  UUID NOT NULL,
  agent_role      TEXT NOT NULL,
  prompt          TEXT,             -- LLM prompt sent (null for non-LLM agents)
  llm_response    TEXT,             -- raw LLM response text (null for non-LLM agents)
  result_status   TEXT NOT NULL,    -- completed / failed / skipped / clarification-needed
  artifact_paths  TEXT[],           -- paths of artifacts produced by this agent
  signal_types    TEXT[],           -- signal types emitted by this agent
  error_message   TEXT,             -- if failed, the error
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_execution_logs_execution_id ON agent_execution_logs(execution_id);
CREATE INDEX idx_execution_logs_correlation  ON agent_execution_logs(correlation_id);
