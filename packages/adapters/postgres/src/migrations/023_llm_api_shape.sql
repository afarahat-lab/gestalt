-- Migration 023: per-LLM API request shape
--
-- OpenAI's reasoning-class models (o1/o3, gpt-5*, …) use the Chat
-- Completions endpoint but reject the legacy `max_tokens` parameter —
-- they require `max_completion_tokens` instead and silently ignore
-- `temperature` (they always reason at temperature=1). This migration
-- adds an explicit `api_shape` field so the operator picks the wire
-- shape per-LLM rather than depending on a model-name regex that
-- OpenAI could break on the next rename.
--
-- Default = 'chat-completions' so every existing row keeps its
-- current behaviour. Operators flip to 'responses' for reasoning
-- models via the dashboard / CLI / direct PATCH.
--
-- The CHECK constraint pins today's two values; future migrations can
-- ALTER TYPE … to add e.g. 'anthropic-messages' / 'gemini-generate'
-- when the registry needs cross-provider variants.
--
-- Pure schema only — no `schema_migrations` writes (runner owns).

ALTER TABLE platform_llms
  ADD COLUMN IF NOT EXISTS api_shape TEXT NOT NULL DEFAULT 'chat-completions';

ALTER TABLE platform_llms
  DROP CONSTRAINT IF EXISTS platform_llms_api_shape_check;

ALTER TABLE platform_llms
  ADD CONSTRAINT platform_llms_api_shape_check
  CHECK (api_shape IN ('chat-completions', 'responses'));
