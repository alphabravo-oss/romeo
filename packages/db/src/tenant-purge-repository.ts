import type { TenantDataPurgeResult } from "@romeo/core";
import { eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  agentKnowledgeBindings,
  agentModels,
  agentToolBindings,
  agentVersions,
  apiKeys,
  auditLogs,
  backgroundJobs,
  baseModels,
  billingPlans,
  chatComments,
  chats,
  chatTagAssignments,
  chatTags,
  dataConnectors,
  dataConnectorSyncs,
  delegatedOAuthConnections,
  deviceAuthorizations,
  evalCases,
  evalResultHumanRatings,
  evalRunResults,
  evalRuns,
  evalSuites,
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
  orgSsoOidcSettings,
  organizations,
  providerCapabilities,
  providerCredentials,
  providerInstances,
  promptTemplates,
  quotaBuckets,
  resourceFavorites,
  resourceGrants,
  retentionPolicies,
  rolePermissions,
  roles,
  runEvents,
  runs,
  runSteps,
  sessions,
  serviceAccounts,
  systemSettings,
  toolCalls,
  toolConnectors,
  toolOperations,
  usageEvents,
  userNotifications,
  userSessions,
  users,
  voiceProfiles,
  webhookDeliveries,
  webhookSubscriptions,
  workflowDefinitions,
  workflowRuns,
  workspaceFolderItems,
  workspaceFolders,
  workspaces,
} from "./schema";

export class PgTenantPurgeRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async purgeTenantData(orgId: string): Promise<TenantDataPurgeResult> {
    return this.db.transaction(async (tx) => {
      const database = tx as unknown as RomeoDatabase;
      const context = await tenantPurgeContext(database, orgId);
      const counts: Record<string, number> = {};

      await deleteWhere(
        database,
        counts,
        "system_settings",
        systemSettings,
        or(
          sql`${systemSettings.value}->>'orgId' = ${orgId}`,
          inArray(systemSettings.key, orgScopedSystemSettingKeys(orgId)),
        ),
      );

      await deleteWhere(
        database,
        counts,
        "workflow_runs",
        workflowRuns,
        eq(workflowRuns.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "webhook_deliveries",
        webhookDeliveries,
        eq(webhookDeliveries.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "notification_deliveries",
        notificationDeliveries,
        eq(notificationDeliveries.orgId, orgId),
      );
      await deleteByIds(
        database,
        counts,
        "message_parts",
        messageParts,
        messageParts.messageId,
        context.messageIds,
      );
      await deleteWhere(
        database,
        counts,
        "chat_comments",
        chatComments,
        eq(chatComments.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "chat_tag_assignments",
        chatTagAssignments,
        eq(chatTagAssignments.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "collaboration_channel_members",
        collaborationChannelMembers,
        eq(collaborationChannelMembers.orgId, orgId),
      );
      await deleteByIds(
        database,
        counts,
        "run_events",
        runEvents,
        runEvents.runId,
        context.runIds,
      );
      await deleteByIds(
        database,
        counts,
        "run_steps",
        runSteps,
        runSteps.runId,
        context.runIds,
      );
      await deleteWhere(
        database,
        counts,
        "tool_calls",
        toolCalls,
        eq(toolCalls.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "usage_events",
        usageEvents,
        eq(usageEvents.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "resource_grants",
        resourceGrants,
        eq(resourceGrants.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "resource_favorites",
        resourceFavorites,
        eq(resourceFavorites.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "workspace_folder_items",
        workspaceFolderItems,
        eq(workspaceFolderItems.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "agent_knowledge_bindings",
        agentKnowledgeBindings,
        eq(agentKnowledgeBindings.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "agent_tool_bindings",
        agentToolBindings,
        eq(agentToolBindings.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "eval_result_human_ratings",
        evalResultHumanRatings,
        eq(evalResultHumanRatings.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "eval_run_results",
        evalRunResults,
        eq(evalRunResults.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "eval_runs",
        evalRuns,
        eq(evalRuns.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "eval_cases",
        evalCases,
        eq(evalCases.orgId, orgId),
      );
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
      await deleteWhere(
        database,
        counts,
        "chats",
        chats,
        eq(chats.orgId, orgId),
      );
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
      await deleteWhere(
        database,
        counts,
        "agent_models",
        agentModels,
        eq(agentModels.orgId, orgId),
      );
      await deleteByIds(
        database,
        counts,
        "provider_capabilities",
        providerCapabilities,
        providerCapabilities.providerId,
        context.providerIds,
      );
      await deleteWhere(
        database,
        counts,
        "provider_credentials",
        providerCredentials,
        eq(providerCredentials.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "base_models",
        baseModels,
        eq(baseModels.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "provider_instances",
        providerInstances,
        eq(providerInstances.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "voice_profiles",
        voiceProfiles,
        eq(voiceProfiles.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "quota_buckets",
        quotaBuckets,
        eq(quotaBuckets.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "billing_plans",
        billingPlans,
        eq(billingPlans.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "retention_policies",
        retentionPolicies,
        eq(retentionPolicies.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "org_sso_oidc_settings",
        orgSsoOidcSettings,
        eq(orgSsoOidcSettings.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "audit_logs",
        auditLogs,
        eq(auditLogs.orgId, orgId),
      );
      await deleteByIds(
        database,
        counts,
        "identities",
        identities,
        identities.userId,
        context.userIds,
      );
      await deleteByIds(
        database,
        counts,
        "sessions",
        sessions,
        sessions.userId,
        context.userIds,
      );
      await deleteByIds(
        database,
        counts,
        "role_permissions",
        rolePermissions,
        rolePermissions.roleId,
        context.roleIds,
      );
      await deleteWhere(
        database,
        counts,
        "roles",
        roles,
        eq(roles.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "background_jobs",
        backgroundJobs,
        eq(backgroundJobs.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "groups",
        groups,
        eq(groups.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "users",
        users,
        eq(users.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "workspaces",
        workspaces,
        eq(workspaces.orgId, orgId),
      );
      await deleteWhere(
        database,
        counts,
        "organizations",
        organizations,
        eq(organizations.id, orgId),
      );

      return {
        organizationDeleted: (counts.organizations ?? 0) > 0,
        recordCounts: counts,
      };
    });
  }
}

async function tenantPurgeContext(
  db: RomeoDatabase,
  orgId: string,
): Promise<{
  messageIds: string[];
  providerIds: string[];
  roleIds: string[];
  runIds: string[];
  userIds: string[];
}> {
  const [messageRows, providerRows, roleRows, runRows, userRows] =
    await Promise.all([
      db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(eq(chats.orgId, orgId)),
      db
        .select({ id: providerInstances.id })
        .from(providerInstances)
        .where(eq(providerInstances.orgId, orgId)),
      db.select({ id: roles.id }).from(roles).where(eq(roles.orgId, orgId)),
      db.select({ id: runs.id }).from(runs).where(eq(runs.orgId, orgId)),
      db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId)),
    ]);
  return {
    messageIds: messageRows.map((row) => row.id),
    providerIds: providerRows.map((row) => row.id),
    roleIds: roleRows.map((row) => row.id),
    runIds: runRows.map((row) => row.id),
    userIds: userRows.map((row) => row.id),
  };
}

async function deleteByIds(
  db: RomeoDatabase,
  counts: Record<string, number>,
  label: string,
  table: Parameters<RomeoDatabase["delete"]>[0],
  column: SQLWrapper,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) {
    counts[label] = 0;
    return;
  }
  await deleteWhere(db, counts, label, table, inArray(column, ids));
}

async function deleteWhere(
  db: RomeoDatabase,
  counts: Record<string, number>,
  label: string,
  table: Parameters<RomeoDatabase["delete"]>[0],
  where: SQL | undefined,
): Promise<void> {
  if (where === undefined) {
    counts[label] = 0;
    return;
  }
  const deleted = await db
    .delete(table)
    .where(where)
    .returning({ deleted: sql<number>`1` });
  counts[label] = deleted.length;
}

function orgScopedSystemSettingKeys(orgId: string): string[] {
  const encodedOrgId = encodeURIComponent(orgId);
  return [
    `abuse_controls.org.v1:${orgId}`,
    `auth_provider_settings.org.v1:${orgId}`,
    `governance.data_export_packages.${encodedOrgId}`,
    `notification_policy.org.v1:${orgId}`,
    `rag_policy.change_request.org.v1:${orgId}`,
    `rag_policy.org.v1:${orgId}`,
    `tenant_lifecycle.deletion_finalization_evidence.v1:${orgId}`,
    `tenant_lifecycle.deletion_request.v1:${orgId}`,
  ];
}
