CREATE TABLE IF NOT EXISTS "organization_capability_flags" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "flag_id" text NOT NULL,
  "state" text NOT NULL,
  "allowlisted_subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" bigint NOT NULL,
  "supersedes_id" text REFERENCES "organization_capability_flags"("id"),
  "actor_id" text NOT NULL,
  "reason" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_capability_flag_state_check" CHECK ("state" IN ('disabled', 'preview', 'enabled')),
  CONSTRAINT "organization_capability_flag_version_check" CHECK ("version" > 0),
  CONSTRAINT "organization_capability_flag_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 1000),
  CONSTRAINT "organization_capability_flag_allowlist_size_check" CHECK (jsonb_typeof("allowlisted_subjects") = 'array' AND jsonb_array_length("allowlisted_subjects") <= 100 AND octet_length("allowlisted_subjects"::text) <= 32768)
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_capability_flag_active_unique_idx"
  ON "organization_capability_flags" ("org_id", "flag_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "organization_capability_flag_version_unique_idx"
  ON "organization_capability_flags" ("org_id", "flag_id", "version");
CREATE INDEX IF NOT EXISTS "organization_capability_flag_history_idx"
  ON "organization_capability_flags" ("org_id", "flag_id", "version");
