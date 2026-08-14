/**
 * Tenant + sort indexes that back inventoried server-driven table pages.
 * Derived resources reuse the audit keyset index.
 */
export const inventoriedTableIndexInventory = {
  api_keys: ["api_keys_user_idx", "api_keys_service_account_idx"],
  background_jobs: ["background_jobs_org_created_idx"],
  groups: ["groups_org_slug_idx"],
  notifications: ["user_notification_lookup_idx"],
  prompt_templates: ["prompt_template_workspace_idx"],
  provider_models: [
    "base_models_org_created_id_idx",
    "base_models_org_display_name_idx",
    "base_models_org_provider_idx",
  ],
  service_accounts: ["service_accounts_org_idx"],
  sessions: ["user_sessions_user_idx"],
  support_access_requests: ["audit_logs_org_created_id_idx"],
  support_sessions: ["audit_logs_org_created_id_idx"],
  tool_connectors: ["tool_connectors_org_updated_idx"],
} as const;
