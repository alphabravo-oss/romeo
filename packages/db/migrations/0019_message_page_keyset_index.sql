CREATE INDEX "messages_chat_created_id_idx" ON "messages" USING btree ("chat_id", "created_at", "id");
