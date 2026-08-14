ALTER TABLE "queued_chat_turns" ADD COLUMN IF NOT EXISTS "research_mode" text NOT NULL DEFAULT 'standard';
