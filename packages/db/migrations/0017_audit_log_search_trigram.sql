-- pg_trgm is installed by the greenfield baseline. This additive expression
-- index avoids a table rewrite and remains safe for older application builds.
CREATE INDEX "audit_logs_search_trgm_idx" ON "audit_logs" USING gin ((lower("action" || chr(31) || "actor_id" || chr(31) || "resource_type" || chr(31) || "resource_id")) gin_trgm_ops);
