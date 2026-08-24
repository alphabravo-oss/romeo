CREATE INDEX IF NOT EXISTS background_jobs_org_created_id_idx
  ON background_jobs (org_id, created_at, id);
CREATE INDEX IF NOT EXISTS background_jobs_org_status_id_idx
  ON background_jobs (org_id, status, id);
CREATE INDEX IF NOT EXISTS background_jobs_org_type_id_idx
  ON background_jobs (org_id, type, id);
CREATE INDEX IF NOT EXISTS background_jobs_search_trgm_idx
  ON background_jobs USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(type, '') || chr(31) || coalesce(status, ''))) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS data_connector_syncs_org_connector_started_id_idx
  ON data_connector_syncs (org_id, connector_id, started_at, id);
CREATE INDEX IF NOT EXISTS data_connector_syncs_org_connector_status_id_idx
  ON data_connector_syncs (org_id, connector_id, status, id);
CREATE INDEX IF NOT EXISTS data_connector_syncs_search_trgm_idx
  ON data_connector_syncs USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(status, ''))) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS notification_deliveries_org_user_created_id_idx
  ON notification_deliveries (org_id, user_id, created_at, id);
CREATE INDEX IF NOT EXISTS notification_deliveries_org_user_status_id_idx
  ON notification_deliveries (org_id, user_id, status, id);
CREATE INDEX IF NOT EXISTS notification_deliveries_search_trgm_idx
  ON notification_deliveries USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(status, '') || chr(31) || coalesce(error_code, ''))) gin_trgm_ops
  );
CREATE INDEX IF NOT EXISTS user_notifications_org_user_created_id_idx
  ON user_notifications (org_id, user_id, created_at, id);
CREATE INDEX IF NOT EXISTS user_notifications_org_user_type_id_idx
  ON user_notifications (org_id, user_id, type, id);
CREATE INDEX IF NOT EXISTS user_notifications_search_trgm_idx
  ON user_notifications USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(type, '') || chr(31) || coalesce(resource_id, ''))) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS tool_calls_org_agent_started_id_idx
  ON tool_calls (org_id, agent_id, started_at, id);
CREATE INDEX IF NOT EXISTS tool_calls_org_agent_completed_id_idx
  ON tool_calls (org_id, agent_id, completed_at, id);
CREATE INDEX IF NOT EXISTS tool_calls_org_agent_status_id_idx
  ON tool_calls (org_id, agent_id, status, id);
CREATE INDEX IF NOT EXISTS tool_calls_org_agent_tool_id_idx
  ON tool_calls (org_id, agent_id, tool_id, id);
CREATE INDEX IF NOT EXISTS tool_calls_search_trgm_idx
  ON tool_calls USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(tool_id, '') || chr(31) || coalesce(run_id, '') || chr(31) || coalesce(error_code, ''))) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS usage_events_org_created_id_idx
  ON usage_events (org_id, created_at, id);
CREATE INDEX IF NOT EXISTS usage_events_org_metric_id_idx
  ON usage_events (org_id, metric, id);
CREATE INDEX IF NOT EXISTS usage_events_search_trgm_idx
  ON usage_events USING gin (
    (lower(coalesce(id, '') || chr(31) || coalesce(metric, ''))) gin_trgm_ops
  );
