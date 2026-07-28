import { eq, inArray, or, sql } from "drizzle-orm";

import {
  agentVersions,
  apiKeys,
  chatTags,
  chats,
  collaborationChannels,
  dataConnectors,
  dataConnectorSyncs,
  delegatedOAuthConnections,
  deviceAuthorizations,
  evalSuites,
  groupMemberships,
  knowledgeBases,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
  localMfaFactors,
  localPasswordCredentials,
  messages,
  notificationDeliveryChannels,
  objectRecords,
  promptTemplates,
  runs,
  serviceAccounts,
  toolConnectors,
  toolOperations,
  userNotifications,
  userSessions,
  webhookSubscriptions,
  workflowDefinitions,
  workspaceFolders,
} from "./schema";
import {
  deleteByIds,
  deleteWhere,
  orgScopedSystemSettingKeys,
  type TenantPurgeState,
} from "./tenant-purge-support";

export async function purgeTenantPhaseTwo({
  context,
  counts,
  database,
  orgId,
}: TenantPurgeState): Promise<void> {
  await deleteWhere(database, counts, "runs", runs, eq(runs.orgId, orgId));
  await deleteWhere(
    database,
    counts,
    "knowledge_chunk_embeddings",
    knowledgeChunkEmbeddings,
    eq(knowledgeChunkEmbeddings.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "knowledge_chunks",
    knowledgeChunks,
    eq(knowledgeChunks.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "knowledge_sources",
    knowledgeSources,
    eq(knowledgeSources.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "data_connector_syncs",
    dataConnectorSyncs,
    eq(dataConnectorSyncs.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "device_authorizations",
    deviceAuthorizations,
    eq(deviceAuthorizations.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "api_keys",
    apiKeys,
    eq(apiKeys.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "local_mfa_factors",
    localMfaFactors,
    eq(localMfaFactors.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "local_password_credentials",
    localPasswordCredentials,
    eq(localPasswordCredentials.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "user_sessions",
    userSessions,
    eq(userSessions.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "service_accounts",
    serviceAccounts,
    eq(serviceAccounts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "group_memberships",
    groupMemberships,
    eq(groupMemberships.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "delegated_oauth_connections",
    delegatedOAuthConnections,
    eq(delegatedOAuthConnections.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "collaboration_channels",
    collaborationChannels,
    eq(collaborationChannels.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "user_notifications",
    userNotifications,
    eq(userNotifications.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "notification_delivery_channels",
    notificationDeliveryChannels,
    eq(notificationDeliveryChannels.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "webhook_subscriptions",
    webhookSubscriptions,
    eq(webhookSubscriptions.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "workflow_definitions",
    workflowDefinitions,
    eq(workflowDefinitions.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "data_connectors",
    dataConnectors,
    eq(dataConnectors.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "knowledge_bases",
    knowledgeBases,
    eq(knowledgeBases.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "object_records",
    objectRecords,
    eq(objectRecords.orgId, orgId),
  );
  await deleteByIds(
    database,
    counts,
    "messages",
    messages,
    messages.id,
    context.messageIds,
  );
  await deleteWhere(
    database,
    counts,
    "prompt_templates",
    promptTemplates,
    eq(promptTemplates.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "workspace_folders",
    workspaceFolders,
    eq(workspaceFolders.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "chat_tags",
    chatTags,
    eq(chatTags.orgId, orgId),
  );
  await deleteWhere(database, counts, "chats", chats, eq(chats.orgId, orgId));
  await deleteWhere(
    database,
    counts,
    "agent_versions",
    agentVersions,
    eq(agentVersions.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "eval_suites",
    evalSuites,
    eq(evalSuites.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "tool_operations",
    toolOperations,
    eq(toolOperations.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "tool_connectors",
    toolConnectors,
    eq(toolConnectors.orgId, orgId),
  );
}
