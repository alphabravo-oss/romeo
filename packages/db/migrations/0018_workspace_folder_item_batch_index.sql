CREATE INDEX "workspace_folder_item_batch_idx" ON "workspace_folder_items" USING btree ("org_id", "workspace_id", "folder_id", "created_at", "id");
