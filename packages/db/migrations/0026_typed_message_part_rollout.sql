ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "parts_schema_version" integer DEFAULT 0 NOT NULL;

ALTER TABLE "message_parts"
  ADD COLUMN IF NOT EXISTS "canonical_position" integer,
  ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_parts_schema_version_check'
  ) THEN
    ALTER TABLE "messages"
      ADD CONSTRAINT "messages_parts_schema_version_check"
      CHECK ("parts_schema_version" IN (0, 1)) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_parts_schema_version_check'
  ) THEN
    ALTER TABLE "message_parts"
      ADD CONSTRAINT "message_parts_schema_version_check"
      CHECK ("schema_version" IN (0, 1)) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_parts_position_check'
  ) THEN
    ALTER TABLE "message_parts"
      ADD CONSTRAINT "message_parts_position_check"
      CHECK (
        ("schema_version" = 0 OR "position" BETWEEN 0 AND 9999)
        AND ("canonical_position" IS NULL OR "canonical_position" BETWEEN 0 AND 9999)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_parts_type_version_check'
  ) THEN
    ALTER TABLE "message_parts"
      ADD CONSTRAINT "message_parts_type_version_check"
      CHECK (
        "schema_version" = 0 OR "type" IN (
          'text', 'image_ref', 'audio_ref', 'video_ref', 'document_ref',
          'tool_result_ref', 'artifact_ref', 'citation_ref'
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_parts_payload_size_check'
  ) THEN
    ALTER TABLE "message_parts"
      ADD CONSTRAINT "message_parts_payload_size_check"
      CHECK (
        "schema_version" = 0 OR (
          octet_length("content") <= 4000064
          AND octet_length("metadata"::text) <= 262144
          AND ("type" = 'text' OR "content" = '')
          AND (
            "type" <> 'text' OR (
              left("content", 22) = 'romeo-message-text-v1:'
              AND length("content") > 22
            )
          )
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "message_parts_canonical_order_idx"
  ON "message_parts" ("message_id", "canonical_position", "position", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "message_parts_message_canonical_position_unique_idx"
  ON "message_parts" ("message_id", "canonical_position")
  WHERE "canonical_position" IS NOT NULL;

CREATE OR REPLACE FUNCTION assign_message_part_canonical_position_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."message_id", 702));
  IF NEW."canonical_position" IS NULL THEN
    SELECT GREATEST(
      COUNT(*)::integer,
      COALESCE(MAX(part."canonical_position"), -1) + 1
    )
      INTO NEW."canonical_position"
      FROM "message_parts" part
      WHERE part."message_id" = NEW."message_id";
  END IF;
  NEW."position" := NEW."canonical_position";
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "message_parts_assign_canonical_position_v1" ON "message_parts";
CREATE TRIGGER "message_parts_assign_canonical_position_v1"
  BEFORE INSERT ON "message_parts"
  FOR EACH ROW EXECUTE FUNCTION assign_message_part_canonical_position_v1();
