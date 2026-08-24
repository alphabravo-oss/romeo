CREATE INDEX IF NOT EXISTS "object_records_file_lifecycle_ops_idx"
  ON "object_records" (
    "org_id", "status", "lifecycle_attempts", "created_at"
  )
  WHERE "status" IN (
    'quarantined', 'scanning', 'extracting', 'transcoding', 'failed'
  );
