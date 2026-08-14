CREATE INDEX "audit_logs_org_created_id_idx" ON "audit_logs" USING btree ("org_id", "created_at", "id");
