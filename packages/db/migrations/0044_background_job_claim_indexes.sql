CREATE INDEX IF NOT EXISTS "background_jobs_org_type_status_created_id_idx"
  ON "background_jobs" ("org_id", "type", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_org_type_status_updated_id_idx"
  ON "background_jobs" ("org_id", "type", "status", "updated_at", "id");
