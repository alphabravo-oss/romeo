ALTER TABLE "retention_policies" ADD COLUMN "run_event_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_org_completed_idx" ON "runs" USING btree ("org_id", "completed_at", "id");
