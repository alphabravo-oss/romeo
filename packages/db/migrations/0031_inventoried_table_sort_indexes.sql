CREATE INDEX "base_models_org_created_id_idx" ON "base_models" USING btree ("org_id", "created_at", "id");
CREATE INDEX "base_models_org_display_name_idx" ON "base_models" USING btree ("org_id", "display_name", "id");
