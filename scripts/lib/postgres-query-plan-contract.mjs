const planTimestamp = "TIMESTAMPTZ '2026-01-01T00:00:00Z'";

export const QUERY_PLAN_REVIEW_CHECKS = [
  {
    id: "chat_search_title_trigram",
    category: "chat-search",
    description: "Workspace chat-title substring search.",
    expectedIndexes: ["chats_title_trgm_idx"],
    representativeRowRequirements: [{ table: "chats", minRows: 100_000 }],
    requireObservedIndexAtRepresentativeVolume: true,
    sql: `
      SELECT id
      FROM chats
      WHERE workspace_id = 'workspace_default'
        AND title ILIKE '%romeo-search-marker%'
      LIMIT 50
    `,
  },
  {
    id: "chat_search_message_trigram",
    category: "chat-search",
    description: "Workspace message-content substring search.",
    expectedIndexes: ["messages_content_trgm_idx"],
    representativeRowRequirements: [{ table: "messages", minRows: 100_000 }],
    requireObservedIndexAtRepresentativeVolume: true,
    sql: `
      SELECT messages.id
      FROM messages
      INNER JOIN chats ON chats.id = messages.chat_id
      WHERE chats.workspace_id = 'workspace_default'
        AND messages.content ILIKE '%romeo-search-marker%'
      LIMIT 50
    `,
  },
  {
    id: "chat_search_attachment_filename_trigram",
    category: "chat-search",
    description: "Workspace attachment-filename substring search.",
    expectedIndexes: ["message_parts_filename_trgm_idx"],
    representativeRowRequirements: [
      { table: "message_parts", minRows: 100_000 },
    ],
    requireObservedIndexAtRepresentativeVolume: true,
    sql: `
      SELECT message_parts.id
      FROM message_parts
      INNER JOIN messages ON messages.id = message_parts.message_id
      INNER JOIN chats ON chats.id = messages.chat_id
      WHERE chats.workspace_id = 'workspace_default'
        AND message_parts.metadata->>'fileName' ILIKE '%romeo-search-marker%'
      LIMIT 50
    `,
  },
  {
    id: "chats_workspace_recent",
    category: "chat-history",
    description: "Recent chat listing for a workspace.",
    expectedIndexes: ["chats_workspace_updated_idx"],
    sql: `
      SELECT id
      FROM chats
      WHERE workspace_id = 'workspace_default'
      ORDER BY updated_at DESC, id ASC
      LIMIT 50
    `,
  },
  {
    id: "messages_chat_ordered",
    category: "chat-history",
    description: "Ordered message replay for a chat.",
    expectedIndexes: ["messages_chat_created_idx"],
    sql: `
      SELECT id
      FROM messages
      WHERE chat_id = 'chat_default'
      ORDER BY created_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "runs_org_recent",
    category: "run-history",
    description: "Recent run listing for an organization.",
    expectedIndexes: ["runs_org_created_idx"],
    sql: `
      SELECT id
      FROM runs
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "run_events_sequence",
    category: "run-history",
    description: "Replay ordered run events for streaming and recovery.",
    expectedIndexes: ["run_event_sequence_idx"],
    sql: `
      SELECT id
      FROM run_events
      WHERE run_id = 'run_default'
      ORDER BY sequence ASC
      LIMIT 200
    `,
  },
  {
    id: "audit_org_recent",
    category: "audit",
    description: "Recent audit listing for admin review.",
    expectedIndexes: ["audit_logs_org_created_idx"],
    sql: `
      SELECT id
      FROM audit_logs
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "audit_retention_delete_candidates",
    category: "governed-deletion",
    description: "Retention worker candidate scan before governed deletion.",
    expectedIndexes: ["audit_logs_org_created_idx"],
    sql: `
      SELECT id
      FROM audit_logs
      WHERE org_id = 'org_default'
        AND created_at < ${planTimestamp}
      ORDER BY created_at ASC
      LIMIT 500
    `,
  },
  {
    id: "audit_org_keyset_page",
    category: "audit",
    description: "Stable keyset page for the server-driven audit table.",
    expectedIndexes: ["audit_logs_org_created_id_idx"],
    sql: `
      SELECT id
      FROM audit_logs
      WHERE org_id = 'org_default'
        AND (created_at, id) < (${planTimestamp}, 'audit_cursor')
      ORDER BY created_at DESC, id DESC
      LIMIT 201
    `,
  },
  {
    id: "audit_org_search_trigram",
    category: "audit-search",
    description:
      "Tenant-scoped literal substring search over the audit allowlist.",
    expectedIndexes: ["audit_logs_search_trgm_idx"],
    representativeRowRequirements: [
      { table: "audit_logs", minRows: 1_000_000 },
    ],
    requireObservedIndexAtRepresentativeVolume: true,
    sql: `
      SELECT id
      FROM audit_logs
      WHERE org_id = 'org_default'
        AND lower(action || chr(31) || actor_id || chr(31) || resource_type || chr(31) || resource_id)
          LIKE '%romeo-audit-search-marker%'
        AND (
          position(lower('romeo-audit-search-marker') in lower(action)) > 0
          OR position(lower('romeo-audit-search-marker') in lower(actor_id)) > 0
          OR position(lower('romeo-audit-search-marker') in lower(resource_type)) > 0
          OR position(lower('romeo-audit-search-marker') in lower(resource_id)) > 0
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 201
    `,
  },
  {
    id: "usage_org_recent",
    category: "usage",
    description: "Recent usage event listing for billing and quota review.",
    expectedIndexes: ["usage_events_org_created_idx"],
    sql: `
      SELECT id
      FROM usage_events
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "background_jobs_queued",
    category: "worker-queue",
    description: "Queued background job scan for worker dispatch.",
    expectedIndexes: ["background_jobs_status_updated_idx"],
    sql: `
      SELECT id
      FROM background_jobs
      WHERE org_id = 'org_default'
        AND status = 'queued'
      ORDER BY updated_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "data_connectors_due_sync",
    category: "connector-sync",
    description: "Due data connector scan for sync workers.",
    expectedIndexes: ["data_connectors_due_sync_idx"],
    sql: `
      SELECT id
      FROM data_connectors
      WHERE status = 'active'
        AND next_sync_at <= ${planTimestamp}
      ORDER BY next_sync_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "data_connector_syncs_connector_recent",
    category: "connector-sync",
    description: "Recent sync history for a connector.",
    expectedIndexes: ["data_connector_syncs_connector_started_idx"],
    sql: `
      SELECT id
      FROM data_connector_syncs
      WHERE org_id = 'org_default'
        AND connector_id = 'connector_default'
      ORDER BY started_at DESC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "workflow_definitions_due_schedule",
    category: "workflow-resume",
    description: "Scheduled workflow scan for due workflow starts.",
    expectedIndexes: ["workflow_definitions_due_schedule_idx"],
    sql: `
      SELECT id
      FROM workflow_definitions
      WHERE org_id = 'org_default'
        AND enabled = true
        AND next_scheduled_run_at <= ${planTimestamp}
      ORDER BY next_scheduled_run_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "workflow_runs_waiting",
    category: "workflow-resume",
    description: "Waiting workflow run scan for resume workers.",
    expectedIndexes: ["workflow_runs_status_updated_idx"],
    sql: `
      SELECT id
      FROM workflow_runs
      WHERE org_id = 'org_default'
        AND status IN ('waiting_run', 'waiting_approval')
      ORDER BY updated_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "notification_delivery_retry",
    category: "notification-retry",
    description: "Failed notification delivery retry scan.",
    expectedIndexes: ["notification_delivery_status_idx"],
    sql: `
      SELECT id
      FROM notification_deliveries
      WHERE org_id = 'org_default'
        AND status = 'failed'
      ORDER BY updated_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "webhook_deliveries_retry_due",
    category: "webhook-retry",
    description: "Failed webhook delivery retry scan.",
    expectedIndexes: ["webhook_deliveries_retry_due_idx"],
    sql: `
      SELECT id
      FROM webhook_deliveries
      WHERE status = 'failed'
        AND next_attempt_at <= ${planTimestamp}
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "knowledge_sources_recent",
    category: "retrieval",
    description: "Recent knowledge source listing for a knowledge base.",
    expectedIndexes: ["knowledge_sources_kb_updated_idx"],
    sql: `
      SELECT id
      FROM knowledge_sources
      WHERE knowledge_base_id = 'kb_default'
      ORDER BY updated_at DESC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "knowledge_chunks_sequence",
    category: "retrieval",
    description: "Ordered chunk scan for indexing and readback.",
    expectedIndexes: ["knowledge_chunks_kb_sequence_idx"],
    sql: `
      SELECT id
      FROM knowledge_chunks
      WHERE knowledge_base_id = 'kb_default'
      ORDER BY sequence ASC
      LIMIT 200
    `,
  },
  {
    id: "knowledge_embedding_vector_search",
    category: "retrieval",
    description:
      "Vector retrieval constrained to one org, workspace, knowledge base, and model.",
    expectedIndexes: [
      "knowledge_chunk_embeddings_kb_idx",
      "knowledge_chunk_embeddings_vector_hnsw_idx",
    ],
    sql: `
      SELECT id
      FROM knowledge_chunk_embeddings
      WHERE org_id = 'org_default'
        AND workspace_id = 'workspace_default'
        AND knowledge_base_id = 'kb_default'
        AND embedding_provider = 'local'
        AND embedding_model = 'mock-embedding'
        AND dimensions = 1536
      ORDER BY embedding <=> ${zeroVector(1536)}, chunk_id ASC
      LIMIT 20
    `,
  },
  {
    id: "resource_grants_lookup",
    category: "access-review",
    description: "Resource permission lookup for governed access checks.",
    expectedIndexes: ["resource_grant_lookup_idx"],
    sql: `
      SELECT id
      FROM resource_grants
      WHERE org_id = 'org_default'
        AND resource_type = 'chat'
        AND resource_id = 'chat_default'
        AND permission = 'read'
      LIMIT 100
    `,
  },
  {
    id: "workspace_folder_items_batch",
    category: "collaboration",
    description: "Tenant-scoped stable folder item batch loading.",
    expectedIndexes: ["workspace_folder_item_batch_idx"],
    sql: `
      SELECT id
      FROM workspace_folder_items
      WHERE org_id = 'org_default'
        AND workspace_id = 'workspace_default'
        AND folder_id IN ('folder_default_a', 'folder_default_b')
      ORDER BY folder_id ASC, created_at ASC, id ASC
      LIMIT 201
    `,
  },
  {
    id: "quota_buckets_org_metric",
    category: "billing",
    description: "Quota bucket scan by organization and metric.",
    expectedIndexes: ["quota_buckets_org_metric_idx"],
    sql: `
      SELECT id
      FROM quota_buckets
      WHERE org_id = 'org_default'
        AND metric = 'run.started'
      ORDER BY scope_type ASC, scope_id ASC
      LIMIT 100
    `,
  },
  {
    id: "quota_buckets_due_reset",
    category: "billing",
    description: "Quota reset worker scan for due buckets.",
    expectedIndexes: ["quota_buckets_reset_idx"],
    sql: `
      SELECT id
      FROM quota_buckets
      WHERE org_id = 'org_default'
        AND reset_at <= ${planTimestamp}
      ORDER BY reset_at ASC, id ASC
      LIMIT 100
    `,
  },
  {
    id: "billing_plan_org",
    category: "billing",
    description: "Billing plan lookup for an organization.",
    expectedIndexes: ["billing_plan_org_idx"],
    sql: `
      SELECT id
      FROM billing_plans
      WHERE org_id = 'org_default'
      LIMIT 1
    `,
  },
  {
    id: "inventoried_api_keys_org_created",
    category: "inventoried-table",
    description: "Tenant API-key table-page sort.",
    expectedIndexes: ["api_keys_user_idx"],
    sql: `
      SELECT id
      FROM api_keys
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
  },
  {
    id: "inventoried_background_jobs_org_created",
    category: "inventoried-table",
    description: "Tenant background-job table-page sort.",
    expectedIndexes: ["background_jobs_org_created_idx"],
    sql: `
      SELECT id
      FROM background_jobs
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
  },
  {
    id: "inventoried_base_models_org_created",
    category: "inventoried-table",
    description: "Tenant model-catalog table-page sort.",
    expectedIndexes: ["base_models_org_created_id_idx"],
    sql: `
      SELECT id
      FROM base_models
      WHERE org_id = 'org_default'
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
  },
];

function zeroVector(dimensions) {
  return `'[${Array.from({ length: dimensions }, () => "0").join(",")}]'::vector`;
}
