import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  agentModels,
  agentVersions,
  apiKeys,
  auditLogs,
  backgroundJobs,
  baseModels,
  billingPlans,
  chatTagAssignments,
  chatTags,
  chats,
  dataConnectors,
  dataConnectorSyncs,
  delegatedOAuthConnections,
  deviceAuthorizations,
  evalResultHumanRatings,
  groupMemberships,
  groups,
  identities,
  knowledgeBases,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
  localMfaFactors,
  localPasswordCredentials,
  messageParts,
  messages,
  notificationDeliveries,
  notificationDeliveryChannels,
  objectRecords,
  collaborationChannelMembers,
  collaborationChannels,
  organizations,
  providerInstances,
  promptTemplates,
  quotaBuckets,
  resourceGrants,
  resourceFavorites,
  runEvents,
  runs,
  serviceAccounts,
  toolCalls,
  toolConnectors,
  toolOperations,
  usageEvents,
  userSessions,
  userNotifications,
  voiceProfiles,
  webhookDeliveries,
  webhookSubscriptions,
  workspaceFolderItems,
  workspaceFolders,
  workflowDefinitions,
  workflowRuns,
} from "./schema";

describe("durable baseline schema contract", () => {
  it("keeps tenant and identity natural keys unique in the greenfield baseline", () => {
    expect(uniqueIndexNames(organizations)).toContain("organization_slug_idx");
    expect(uniqueIndexNames(groups)).toContain("groups_org_slug_idx");
    expect(uniqueIndexNames(apiKeys)).toContain("api_keys_hash_idx");
    expect(uniqueIndexNames(userSessions)).toContain("user_sessions_hash_idx");
    expect(uniqueIndexNames(deviceAuthorizations)).toContain(
      "device_authorizations_refresh_hash_idx",
    );
    expect(uniqueIndexNames(identities)).toContain(
      "identities_provider_subject_idx",
    );
    expect(uniqueIndexNames(providerInstances)).toContain(
      "provider_instances_org_name_idx",
    );
    expect(uniqueIndexNames(baseModels)).toContain(
      "base_models_provider_name_idx",
    );
    expect(uniqueIndexNames(agentModels)).toContain(
      "agent_models_workspace_slug_idx",
    );
    expect(uniqueIndexNames(agentVersions)).toContain(
      "agent_versions_agent_version_idx",
    );
    expect(uniqueIndexNames(evalResultHumanRatings)).toContain(
      "eval_result_human_rating_reviewer_idx",
    );
  });

  it("stores group membership org ownership for repository filtering", () => {
    expect(columnNames(groupMemberships)).toEqual([
      "org_id",
      "group_id",
      "user_id",
      "created_at",
    ]);
  });

  it("keeps chat and message ordering indexes explicit", () => {
    expect(indexNames(chats)).toContain("chats_workspace_updated_idx");
    expect(indexNames(messages)).toContain("messages_chat_created_idx");
    expect(indexNames(messageParts)).toContain(
      "message_parts_message_position_idx",
    );
    expect(columnNames(messageParts)).toContain("position");
  });

  it("keeps object-record upload indexes and lifecycle columns explicit", () => {
    expect(indexNames(objectRecords)).toEqual(
      expect.arrayContaining([
        "object_records_owner_updated_idx",
        "object_records_sha256_idx",
        "object_records_workspace_updated_idx",
      ]),
    );
    expect(columnNames(objectRecords)).toEqual(
      expect.arrayContaining([
        "owner_type",
        "owner_id",
        "object_key",
        "sha256",
        "status",
        "created_at",
        "updated_at",
        "deleted_at",
      ]),
    );
  });

  it("keeps run replay and tool-call audit indexes explicit", () => {
    expect(uniqueIndexNames(runEvents)).toContain("run_event_sequence_idx");
    expect(indexNames(runs)).toEqual(
      expect.arrayContaining(["runs_chat_created_idx", "runs_org_created_idx"]),
    );
    expect(indexNames(toolCalls)).toEqual(
      expect.arrayContaining([
        "tool_calls_org_started_idx",
        "tool_calls_run_idx",
      ]),
    );
  });

  it("keeps knowledge list and chunk sequence indexes explicit", () => {
    expect(indexNames(knowledgeBases)).toContain(
      "knowledge_bases_workspace_idx",
    );
    expect(indexNames(knowledgeSources)).toContain(
      "knowledge_sources_kb_updated_idx",
    );
    expect(indexNames(knowledgeChunks)).toContain(
      "knowledge_chunks_kb_sequence_idx",
    );
    expect(uniqueIndexNames(knowledgeChunks)).toContain(
      "knowledge_chunks_source_sequence_idx",
    );
    expect(uniqueIndexNames(knowledgeChunkEmbeddings)).toContain(
      "knowledge_chunk_embeddings_chunk_model_unique_idx",
    );
    expect(indexNames(knowledgeChunkEmbeddings)).toEqual(
      expect.arrayContaining([
        "knowledge_chunk_embeddings_kb_idx",
        "knowledge_chunk_embeddings_vector_hnsw_idx",
      ]),
    );
  });

  it("keeps auth credential lookup and list indexes explicit", () => {
    expect(indexNames(apiKeys)).toEqual(
      expect.arrayContaining([
        "api_keys_user_idx",
        "api_keys_service_account_idx",
      ]),
    );
    expect(indexNames(deviceAuthorizations)).toContain(
      "device_authorizations_user_idx",
    );
    expect(indexNames(serviceAccounts)).toContain("service_accounts_org_idx");
    expect(indexNames(userSessions)).toContain("user_sessions_user_idx");
    expect(uniqueIndexNames(localPasswordCredentials)).toEqual(
      expect.arrayContaining([
        "local_password_credentials_email_idx",
        "local_password_credentials_user_idx",
      ]),
    );
    expect(indexNames(localMfaFactors)).toEqual(
      expect.arrayContaining([
        "local_mfa_factors_user_status_idx",
        "local_mfa_factors_user_type_idx",
      ]),
    );
  });

  it("keeps tool connector natural keys and list indexes explicit", () => {
    expect(indexNames(toolConnectors)).toContain(
      "tool_connectors_org_updated_idx",
    );
    expect(uniqueIndexNames(toolConnectors)).toContain(
      "tool_connectors_org_name_idx",
    );
    expect(indexNames(toolOperations)).toContain(
      "tool_operations_connector_idx",
    );
    expect(uniqueIndexNames(toolOperations)).toContain(
      "tool_operations_connector_operation_idx",
    );
  });

  it("keeps data connector list, sync, and scheduling indexes explicit", () => {
    expect(indexNames(dataConnectors)).toEqual(
      expect.arrayContaining([
        "data_connectors_workspace_created_idx",
        "data_connectors_kb_idx",
        "data_connectors_due_sync_idx",
      ]),
    );
    expect(uniqueIndexNames(dataConnectors)).toContain(
      "data_connectors_workspace_name_idx",
    );
    expect(indexNames(dataConnectorSyncs)).toEqual(
      expect.arrayContaining([
        "data_connector_syncs_org_started_idx",
        "data_connector_syncs_connector_started_idx",
      ]),
    );
  });

  it("keeps delegated OAuth connection ownership and provider-account indexes explicit", () => {
    expect(columnNames(delegatedOAuthConnections)).toEqual(
      expect.arrayContaining([
        "provider_account_id",
        "status",
        "token",
        "revoked_at",
        "updated_at",
      ]),
    );
    expect(indexNames(delegatedOAuthConnections)).toEqual(
      expect.arrayContaining([
        "delegated_oauth_connections_user_updated_idx",
        "delegated_oauth_connections_status_idx",
      ]),
    );
    expect(uniqueIndexNames(delegatedOAuthConnections)).toContain(
      "delegated_oauth_connections_provider_account_idx",
    );
  });

  it("keeps operational audit, usage, and job indexes explicit", () => {
    expect(indexNames(auditLogs)).toEqual(
      expect.arrayContaining([
        "audit_logs_org_created_idx",
        "audit_logs_resource_idx",
        "audit_logs_actor_created_idx",
      ]),
    );
    expect(indexNames(usageEvents)).toEqual(
      expect.arrayContaining([
        "usage_events_org_created_idx",
        "usage_events_workspace_created_idx",
        "usage_events_source_idx",
        "usage_events_metric_created_idx",
      ]),
    );
    expect(indexNames(backgroundJobs)).toEqual(
      expect.arrayContaining([
        "background_jobs_org_created_idx",
        "background_jobs_workspace_created_idx",
        "background_jobs_status_updated_idx",
      ]),
    );
  });

  it("keeps webhook subscription, delivery, and retry indexes explicit", () => {
    expect(indexNames(webhookSubscriptions)).toContain(
      "webhook_subscriptions_org_created_idx",
    );
    expect(uniqueIndexNames(webhookSubscriptions)).toContain(
      "webhook_subscriptions_org_url_idx",
    );
    expect(indexNames(webhookDeliveries)).toEqual(
      expect.arrayContaining([
        "webhook_deliveries_org_created_idx",
        "webhook_deliveries_subscription_created_idx",
        "webhook_deliveries_retry_due_idx",
      ]),
    );
  });

  it("keeps workflow definition, schedule, and run indexes explicit", () => {
    expect(columnNames(workflowDefinitions)).toContain("next_scheduled_run_at");
    expect(indexNames(workflowDefinitions)).toEqual(
      expect.arrayContaining([
        "workflow_definitions_workspace_updated_idx",
        "workflow_definitions_due_schedule_idx",
      ]),
    );
    expect(uniqueIndexNames(workflowDefinitions)).toContain(
      "workflow_definitions_workspace_name_idx",
    );
    expect(indexNames(workflowRuns)).toEqual(
      expect.arrayContaining([
        "workflow_runs_workflow_created_idx",
        "workflow_runs_status_updated_idx",
        "workflow_runs_workspace_created_idx",
      ]),
    );
  });

  it("keeps quota and billing uniqueness and lookup indexes explicit", () => {
    expect(uniqueIndexNames(quotaBuckets)).toContain(
      "quota_bucket_scope_metric_idx",
    );
    expect(indexNames(quotaBuckets)).toEqual(
      expect.arrayContaining([
        "quota_buckets_org_metric_idx",
        "quota_buckets_reset_idx",
      ]),
    );
    expect(uniqueIndexNames(billingPlans)).toContain("billing_plan_org_idx");
    expect(indexNames(billingPlans)).toEqual(
      expect.arrayContaining([
        "billing_plans_external_customer_idx",
        "billing_plans_external_subscription_idx",
      ]),
    );
  });

  it("keeps notification list, unread, delivery, and channel indexes explicit", () => {
    expect(indexNames(userNotifications)).toEqual(
      expect.arrayContaining([
        "user_notification_lookup_idx",
        "user_notification_unread_idx",
        "user_notification_resource_idx",
      ]),
    );
    expect(indexNames(notificationDeliveryChannels)).toContain(
      "notification_delivery_channel_lookup_idx",
    );
    expect(uniqueIndexNames(notificationDeliveryChannels)).toContain(
      "notification_delivery_channel_user_name_idx",
    );
    expect(indexNames(notificationDeliveries)).toEqual(
      expect.arrayContaining([
        "notification_delivery_notification_idx",
        "notification_delivery_user_idx",
        "notification_delivery_status_idx",
      ]),
    );
  });

  it("keeps collaboration uniqueness and folder lookup indexes explicit", () => {
    expect(uniqueIndexNames(resourceFavorites)).toContain(
      "resource_favorite_unique_idx",
    );
    expect(indexNames(resourceFavorites)).toContain(
      "resource_favorite_lookup_idx",
    );
    expect(indexNames(promptTemplates)).toContain(
      "prompt_template_workspace_idx",
    );
    expect(uniqueIndexNames(promptTemplates)).toContain(
      "prompt_template_workspace_name_idx",
    );
    expect(indexNames(workspaceFolders)).toContain(
      "workspace_folder_workspace_idx",
    );
    expect(uniqueIndexNames(workspaceFolders)).toContain(
      "workspace_folder_name_idx",
    );
    expect(indexNames(workspaceFolderItems)).toEqual(
      expect.arrayContaining([
        "workspace_folder_item_folder_idx",
        "workspace_folder_item_resource_idx",
      ]),
    );
    expect(uniqueIndexNames(workspaceFolderItems)).toContain(
      "workspace_folder_item_unique_idx",
    );
    expect(indexNames(chatTags)).toContain("chat_tags_user_name_idx");
    expect(uniqueIndexNames(chatTags)).toContain("chat_tags_user_slug_idx");
    expect(indexNames(chatTagAssignments)).toEqual(
      expect.arrayContaining([
        "chat_tag_assignments_chat_idx",
        "chat_tag_assignments_tag_idx",
      ]),
    );
    expect(uniqueIndexNames(chatTagAssignments)).toContain(
      "chat_tag_assignments_unique_idx",
    );
    expect(indexNames(collaborationChannels)).toEqual(
      expect.arrayContaining([
        "collaboration_channels_org_updated_idx",
        "collaboration_channels_workspace_updated_idx",
        "collaboration_channels_owner_idx",
      ]),
    );
    expect(indexNames(collaborationChannelMembers)).toEqual(
      expect.arrayContaining([
        "collaboration_channel_members_channel_idx",
        "collaboration_channel_members_user_idx",
      ]),
    );
    expect(uniqueIndexNames(collaborationChannelMembers)).toContain(
      "collaboration_channel_members_unique_idx",
    );
  });

  it("keeps resource grant lookup and natural-key indexes explicit", () => {
    expect(indexNames(resourceGrants)).toEqual(
      expect.arrayContaining([
        "resource_grant_lookup_idx",
        "resource_grant_principal_idx",
      ]),
    );
    expect(uniqueIndexNames(resourceGrants)).toContain(
      "resource_grant_unique_idx",
    );
  });

  it("keeps voice profile list, enabled lookup, and provider voice indexes explicit", () => {
    expect(columnNames(voiceProfiles)).toContain("updated_at");
    expect(indexNames(voiceProfiles)).toEqual(
      expect.arrayContaining([
        "voice_profiles_org_created_idx",
        "voice_profiles_enabled_language_idx",
      ]),
    );
    expect(uniqueIndexNames(voiceProfiles)).toContain(
      "voice_profiles_provider_voice_idx",
    );
  });
});

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function uniqueIndexNames(
  table: Parameters<typeof getTableConfig>[0],
): string[] {
  return getTableConfig(table)
    .indexes.filter((index) => index.config.unique)
    .map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}
