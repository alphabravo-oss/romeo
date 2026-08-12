ALTER TABLE "queued_chat_turns" ADD COLUMN IF NOT EXISTS "agentic_rag" boolean NOT NULL DEFAULT false;
