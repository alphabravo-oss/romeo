ALTER TABLE "object_records"
  ADD COLUMN IF NOT EXISTS "lifecycle_version" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "lifecycle_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "lifecycle_failure_code" text,
  ADD COLUMN IF NOT EXISTS "lifecycle_next_attempt_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lifecycle_lease_owner" text,
  ADD COLUMN IF NOT EXISTS "lifecycle_lease_token" text,
  ADD COLUMN IF NOT EXISTS "lifecycle_lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "attached_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "retained_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'object_records_status_check') THEN
    ALTER TABLE "object_records" ADD CONSTRAINT "object_records_status_check"
      CHECK ("status" IN (
        'uploading', 'quarantined', 'scanning', 'extracting', 'transcoding',
        'ready', 'attached', 'retained', 'failed', 'deleted', 'available'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'object_records_lifecycle_attempts_check') THEN
    ALTER TABLE "object_records" ADD CONSTRAINT "object_records_lifecycle_attempts_check"
      CHECK ("lifecycle_attempts" BETWEEN 0 AND 100) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'object_records_lifecycle_failure_code_check') THEN
    ALTER TABLE "object_records" ADD CONSTRAINT "object_records_lifecycle_failure_code_check"
      CHECK ("lifecycle_failure_code" IS NULL OR "lifecycle_failure_code" ~ '^[a-z0-9_]{1,80}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'object_records_lifecycle_lease_check') THEN
    ALTER TABLE "object_records" ADD CONSTRAINT "object_records_lifecycle_lease_check"
      CHECK (
        ("lifecycle_lease_owner" IS NULL AND "lifecycle_lease_token" IS NULL AND "lifecycle_lease_expires_at" IS NULL)
        OR
        ("lifecycle_lease_owner" IS NOT NULL AND "lifecycle_lease_token" IS NOT NULL AND "lifecycle_lease_expires_at" IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "object_records_lifecycle_claim_idx"
  ON "object_records" (
    "status", "lifecycle_next_attempt_at", "lifecycle_lease_expires_at",
    "updated_at", "id"
  );
