import { eq } from "drizzle-orm";

import {
  agentKnowledgeBindings,
  agentToolBindings,
  chatComments,
  chatTagAssignments,
  capabilityAssignments,
  organizationCapabilityFlags,
  idempotencyReceipts,
  collaborationChannelMembers,
  contentDeletionOperations,
  evalCases,
  evalResultHumanRatings,
  evalRunResults,
  evalRuns,
  governanceExportArtifacts,
  governanceExportJobs,
  messageParts,
  notificationDeliveries,
  resourceFavorites,
  resourceGrants,
  runEvents,
  runSteps,
  serverTableSavedViews,
  systemSettings,
  toolCalls,
  usageEvents,
  webhookDeliveries,
  workflowRuns,
  workspaceFolderItems,
} from "./schema";
import {
  deleteByIds,
  deleteWhere,
  type TenantPurgeState,
} from "./tenant-purge-support";

export async function purgeTenantPhaseOne({
  context,
  counts,
  database,
  orgId,
}: TenantPurgeState): Promise<void> {
  await deleteWhere(
    database,
    counts,
    "content_deletion_operations",
    contentDeletionOperations,
    eq(contentDeletionOperations.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "capability_assignments",
    capabilityAssignments,
    eq(capabilityAssignments.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "idempotency_receipts",
    idempotencyReceipts,
    eq(idempotencyReceipts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "organization_capability_flags",
    organizationCapabilityFlags,
    eq(organizationCapabilityFlags.orgId, orgId),
  );

  await deleteWhere(
    database,
    counts,
    "governance_export_artifacts",
    governanceExportArtifacts,
    eq(governanceExportArtifacts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "governance_export_jobs",
    governanceExportJobs,
    eq(governanceExportJobs.orgId, orgId),
  );

  await deleteWhere(
    database,
    counts,
    "system_settings",
    systemSettings,
    eq(systemSettings.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "server_table_saved_views",
    serverTableSavedViews,
    eq(serverTableSavedViews.orgId, orgId),
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
}
