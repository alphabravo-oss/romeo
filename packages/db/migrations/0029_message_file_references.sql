CREATE TABLE IF NOT EXISTS "message_file_references" (
  "message_part_id" text NOT NULL REFERENCES "message_parts"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "file_id" text NOT NULL REFERENCES "object_records"("id") ON DELETE RESTRICT,
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "message_file_references_pk" PRIMARY KEY ("message_part_id", "file_id"),
  CONSTRAINT "message_file_references_identity_check" CHECK (
    octet_length("message_part_id") BETWEEN 1 AND 300
    AND octet_length("message_id") BETWEEN 1 AND 300
    AND octet_length("file_id") BETWEEN 1 AND 300
    AND octet_length("org_id") BETWEEN 1 AND 300
    AND octet_length("workspace_id") BETWEEN 1 AND 300
  )
);

CREATE INDEX IF NOT EXISTS "message_file_references_file_idx"
  ON "message_file_references" ("file_id", "message_id", "message_part_id");

CREATE INDEX IF NOT EXISTS "message_file_references_message_idx"
  ON "message_file_references" ("message_id", "file_id", "message_part_id");
