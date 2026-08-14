ALTER TABLE "chats"
  ADD COLUMN IF NOT EXISTS "transcript_version" bigint DEFAULT 0 NOT NULL;

CREATE OR REPLACE FUNCTION "bump_chat_transcript_version_for_leaf"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_leaf_message_id IS DISTINCT FROM OLD.active_leaf_message_id THEN
    NEW.transcript_version := OLD.transcript_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "chats_transcript_version_leaf_trigger" ON "chats";
CREATE TRIGGER "chats_transcript_version_leaf_trigger"
BEFORE UPDATE OF "active_leaf_message_id" ON "chats"
FOR EACH ROW
EXECUTE FUNCTION "bump_chat_transcript_version_for_leaf"();

CREATE OR REPLACE FUNCTION "bump_chat_transcript_version_for_message_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE chats
  SET transcript_version = transcript_version + 1
  WHERE id IN (SELECT DISTINCT chat_id FROM new_message_rows);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "messages_transcript_version_insert_trigger" ON "messages";
CREATE TRIGGER "messages_transcript_version_insert_trigger"
AFTER INSERT ON "messages"
REFERENCING NEW TABLE AS new_message_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_chat_transcript_version_for_message_insert"();

CREATE OR REPLACE FUNCTION "bump_chat_transcript_version_for_message_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE chats
  SET transcript_version = transcript_version + 1
  WHERE id IN (SELECT DISTINCT chat_id FROM old_message_rows);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "messages_transcript_version_delete_trigger" ON "messages";
CREATE TRIGGER "messages_transcript_version_delete_trigger"
AFTER DELETE ON "messages"
REFERENCING OLD TABLE AS old_message_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_chat_transcript_version_for_message_delete"();

CREATE OR REPLACE FUNCTION "bump_chat_transcript_version_for_message_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE chats
  SET transcript_version = transcript_version + 1
  WHERE id IN (
    SELECT DISTINCT new_rows.chat_id
    FROM new_message_rows new_rows
    JOIN old_message_rows old_rows ON old_rows.id = new_rows.id
    WHERE new_rows IS DISTINCT FROM old_rows
    UNION
    SELECT DISTINCT old_rows.chat_id
    FROM new_message_rows new_rows
    JOIN old_message_rows old_rows ON old_rows.id = new_rows.id
    WHERE new_rows IS DISTINCT FROM old_rows
      AND new_rows.chat_id IS DISTINCT FROM old_rows.chat_id
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "messages_transcript_version_update_trigger" ON "messages";
CREATE TRIGGER "messages_transcript_version_update_trigger"
AFTER UPDATE ON "messages"
REFERENCING OLD TABLE AS old_message_rows NEW TABLE AS new_message_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_chat_transcript_version_for_message_update"();
