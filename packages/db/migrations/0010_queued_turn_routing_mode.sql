ALTER TABLE "queued_chat_turns" ADD COLUMN IF NOT EXISTS "routing_mode" text NOT NULL DEFAULT 'selected';
