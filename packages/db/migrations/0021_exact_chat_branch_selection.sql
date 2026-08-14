ALTER TABLE "queued_chat_turns"
  ADD COLUMN IF NOT EXISTS "parent_message_configured" boolean DEFAULT false NOT NULL;

ALTER TABLE "queued_chat_turns"
  ADD COLUMN IF NOT EXISTS "parent_message_id" text;

CREATE INDEX IF NOT EXISTS "messages_chat_parent_created_id_idx"
  ON "messages" USING btree ("chat_id", "parent_id", "created_at", "id");
