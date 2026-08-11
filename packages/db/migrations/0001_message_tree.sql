ALTER TABLE "chats" ADD COLUMN "active_leaf_message_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "parent_id" text;--> statement-breakpoint
-- Backfill: existing chats are linear, so each message's parent is the one before it.
-- ("role" <> 'user') reproduces roleRank from compareChatMessages: without it an assistant
-- sharing a millisecond with its own user turn becomes that turn's parent and the chat renders inverted.
WITH ordered AS (SELECT "id", lag("id") OVER (PARTITION BY "chat_id" ORDER BY "created_at" ASC, ("role" <> 'user') ASC, "id" ASC) AS parent FROM "messages")
UPDATE "messages" AS m SET "parent_id" = ordered.parent FROM ordered WHERE m."id" = ordered."id" AND ordered.parent IS NOT NULL;--> statement-breakpoint
-- Point every chat at its last message; a chat with no messages keeps NULL and renders as empty.
WITH leaf AS (SELECT DISTINCT ON ("chat_id") "chat_id", "id" FROM "messages" ORDER BY "chat_id", "created_at" DESC, ("role" <> 'user') DESC, "id" DESC)
UPDATE "chats" AS c SET "active_leaf_message_id" = leaf."id" FROM leaf WHERE c."id" = leaf."chat_id";
