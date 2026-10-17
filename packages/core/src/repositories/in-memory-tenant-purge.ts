import type * as Auth from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type * as E from "../domain/entities";
import type { TenantDataPurgeResult } from "../domain/repository";
import type { SeedData } from "./seed-data";
import { removeSeedRecords } from "./in-memory-tenant-purge-support";
export async function purgeTenantData(
  data: SeedData,
  runEvents: Map<string, RunEvent[]>,
  orgId: string,
): Promise<TenantDataPurgeResult> {
  const orgIds = new Set([orgId]);
  const workspaceIds = new Set(
    data.workspaces
      .filter((workspace) => workspace.orgId === orgId)
      .map((workspace) => workspace.id),
  );
  const userIds = new Set(
    data.users.filter((user) => user.orgId === orgId).map((user) => user.id),
  );
  const groupIds = new Set(
    data.groups
      .filter((group) => group.orgId === orgId)
      .map((group) => group.id),
  );
  const providerIds = new Set(
    data.providers
      .filter((provider) => provider.orgId === orgId)
      .map((provider) => provider.id),
  );
  const modelIds = new Set(
    data.models
      .filter((model) => providerIds.has(model.providerId))
      .map((model) => model.id),
  );
  const agentIds = new Set(
    data.agents
      .filter((agent) => agent.orgId === orgId)
      .map((agent) => agent.id),
  );
  const evalSuiteIds = new Set(
    data.evalSuites
      .filter((suite) => suite.orgId === orgId)
      .map((suite) => suite.id),
  );
  const evalRunIds = new Set(
    data.evalRuns.filter((run) => run.orgId === orgId).map((run) => run.id),
  );
  const evalResultIds = new Set(
    data.evalRunResults
      .filter((result) => result.orgId === orgId)
      .map((result) => result.id),
  );
  const chatIds = new Set(
    data.chats.filter((chat) => chat.orgId === orgId).map((chat) => chat.id),
  );
  const messageIds = new Set(
    data.messages
      .filter((message) => chatIds.has(message.chatId))
      .map((message) => message.id),
  );
  const tagIds = new Set(
    data.chatTags.filter((tag) => tag.orgId === orgId).map((tag) => tag.id),
  );
  const notificationIds = new Set(
    data.userNotifications
      .filter((notification) => notification.orgId === orgId)
      .map((notification) => notification.id),
  );
  const notificationChannelIds = new Set(
    data.notificationDeliveryChannels
      .filter((channel) => channel.orgId === orgId)
      .map((channel) => channel.id),
  );
  const knowledgeBaseIds = new Set(
    data.knowledgeBases
      .filter((base) => base.orgId === orgId)
      .map((base) => base.id),
  );
  const knowledgeSourceIds = new Set(
    data.knowledgeSources
      .filter((source) => source.orgId === orgId)
      .map((source) => source.id),
  );
  const knowledgeChunkIds = new Set(
    data.knowledgeChunks
      .filter((chunk) => chunk.orgId === orgId)
      .map((chunk) => chunk.id),
  );
  const runIds = new Set(
    data.runs.filter((run) => run.orgId === orgId).map((run) => run.id),
  );
  const toolConnectorIds = new Set(
    data.toolConnectors
      .filter((connector) => connector.orgId === orgId)
      .map((connector) => connector.id),
  );
  const toolOperationIds = new Set(
    data.toolOperations
      .filter(
        (operation) =>
          operation.orgId === orgId ||
          toolConnectorIds.has(operation.connectorId),
      )
      .map((operation) => operation.id),
  );
  const webhookSubscriptionIds = new Set(
    data.webhookSubscriptions
      .filter((subscription) => subscription.orgId === orgId)
      .map((subscription) => subscription.id),
  );
  const folderIds = new Set(
    data.workspaceFolders
      .filter((folder) => folder.orgId === orgId)
      .map((folder) => folder.id),
  );
  const fileIds = new Set(
    data.fileObjects
      .filter((file) => file.orgId === orgId)
      .map((file) => file.id),
  );
  const promptTemplateIds = new Set(
    data.promptTemplates
      .filter((template) => template.orgId === orgId)
      .map((template) => template.id),
  );
  const serviceAccountIds = new Set(
    data.serviceAccounts
      .filter((account) => account.orgId === orgId)
      .map((account) => account.id),
  );
  const voiceProfileIds = new Set(
    data.voiceProfiles
      .filter((profile) => profile.orgId === orgId)
      .map((profile) => profile.id),
  );
  const tenantResourceIds = new Set([
    ...orgIds,
    ...workspaceIds,
    ...providerIds,
    ...modelIds,
    ...agentIds,
    ...chatIds,
    ...runIds,
    ...fileIds,
    ...knowledgeBaseIds,
    ...promptTemplateIds,
    ...folderIds,
    ...toolConnectorIds,
    ...toolOperationIds,
    ...voiceProfileIds,
  ]);
  const tenantPrincipalIds = new Set([
    ...userIds,
    ...groupIds,
    ...serviceAccountIds,
  ]);
  const counts: Record<string, number> = {};
  const remove = <T>(
    key: keyof SeedData,
    predicate: (item: T) => boolean,
  ): void => removeSeedRecords(data, counts, key, predicate);
  let runEventCount = 0;
  for (const runId of runIds) {
    runEventCount += runEvents.get(runId)?.length ?? 0;
    runEvents.delete(runId);
  }
  counts.runEvents = runEventCount;

  remove<E.SystemSetting>(
    "systemSettings",
    (setting) => setting.orgId === orgId,
  );
  remove<E.ServerTableSavedViewRecord>(
    "serverTableSavedViews",
    (view) => view.orgId === orgId,
  );
  remove<E.CapabilityAssignment>(
    "capabilityAssignments",
    (assignment) => assignment.orgId === orgId,
  );
  remove<import("../domain/capability-flags").OrganizationCapabilityFlag>(
    "organizationCapabilityFlags",
    (flag) => flag.orgId === orgId,
  );
  remove<import("../domain/idempotency").IdempotencyReceipt>(
    "idempotencyReceipts",
    (receipt) => receipt.orgId === orgId,
  );
  remove<E.WebhookDelivery>(
    "webhookDeliveries",
    (delivery) =>
      delivery.orgId === orgId ||
      webhookSubscriptionIds.has(delivery.subscriptionId),
  );
  remove<E.NotificationDelivery>(
    "notificationDeliveries",
    (delivery) =>
      delivery.orgId === orgId ||
      notificationIds.has(delivery.notificationId) ||
      notificationChannelIds.has(delivery.channelId),
  );
  remove<E.MessagePart>("messageParts", (part) =>
    messageIds.has(part.messageId),
  );
  remove<E.MessageFileReference>(
    "messageFileReferences",
    (reference) => reference.orgId === orgId,
  );
  remove<E.Message>("messages", (message) => chatIds.has(message.chatId));
  remove<E.QueuedChatTurn>(
    "queuedChatTurns",
    (turn) => turn.orgId === orgId || chatIds.has(turn.chatId),
  );
  remove<E.ChatComment>(
    "chatComments",
    (comment) => comment.orgId === orgId || chatIds.has(comment.chatId),
  );
  remove<E.ChatTagAssignment>(
    "chatTagAssignments",
    (assignment) =>
      assignment.orgId === orgId ||
      chatIds.has(assignment.chatId) ||
      tagIds.has(assignment.tagId),
  );
  remove<E.CollaborationChannelMember>(
    "collaborationChannelMembers",
    (member) => member.orgId === orgId,
  );
  remove<E.ToolCallRecord>(
    "toolCalls",
    (call) => call.orgId === orgId || runIds.has(call.runId ?? ""),
  );
  remove<E.UsageEvent>("usageEvents", (event) => event.orgId === orgId);
  remove<Auth.ResourceGrant>(
    "grants",
    (grant) =>
      tenantResourceIds.has(grant.resourceId) ||
      tenantPrincipalIds.has(grant.principalId),
  );
  remove<E.ResourceFavorite>(
    "resourceFavorites",
    (favorite) => favorite.orgId === orgId,
  );
  remove<E.WorkspaceFolderItem>(
    "workspaceFolderItems",
    (item) => item.orgId === orgId || folderIds.has(item.folderId),
  );
  remove<E.AgentKnowledgeBinding>(
    "agentKnowledgeBindings",
    (binding) =>
      binding.orgId === orgId ||
      agentIds.has(binding.agentId) ||
      knowledgeBaseIds.has(binding.knowledgeBaseId),
  );
  remove<E.AgentToolBinding>(
    "agentToolBindings",
    (binding) => binding.orgId === orgId || agentIds.has(binding.agentId),
  );
  remove<E.ManagedModelCustomizationPolicyRecord>(
    "managedModelCustomizationPolicies",
    (policy) => policy.orgId === orgId || agentIds.has(policy.agentId),
  );
  remove<E.ManagedModelPreferenceRecord>(
    "managedModelPreferences",
    (preference) =>
      preference.orgId === orgId || agentIds.has(preference.agentId),
  );
  remove<E.EvalResultHumanRating>(
    "evalResultHumanRatings",
    (rating) =>
      rating.orgId === orgId ||
      evalRunIds.has(rating.runId) ||
      evalResultIds.has(rating.resultId),
  );
  remove<E.EvalRunResult>(
    "evalRunResults",
    (result) => result.orgId === orgId || evalRunIds.has(result.runId),
  );
  remove<E.EvalRun>(
    "evalRuns",
    (run) => run.orgId === orgId || evalSuiteIds.has(run.suiteId),
  );
  remove<E.EvalCase>(
    "evalCases",
    (testCase) =>
      testCase.orgId === orgId || evalSuiteIds.has(testCase.suiteId),
  );
  remove<import("../domain/content-policy").PolicyApprovalRecord>(
    "contentPolicyApprovals",
    (approval) => approval.orgId === orgId,
  );
  remove<import("../domain/content-policy").ContentPolicyDecisionRecord>(
    "contentPolicyDecisions",
    (decision) => decision.orgId === orgId,
  );
  remove<E.ContentDeletionOperation>(
    "contentDeletionOperations",
    (operation) => operation.orgId === orgId,
  );
  remove<E.RunRecord>("runs", (run) => run.orgId === orgId);
  remove<E.KnowledgeChunkEmbedding>(
    "knowledgeChunkEmbeddings",
    (embedding) =>
      embedding.orgId === orgId ||
      knowledgeBaseIds.has(embedding.knowledgeBaseId) ||
      knowledgeSourceIds.has(embedding.sourceId) ||
      knowledgeChunkIds.has(embedding.chunkId),
  );
  remove<E.KnowledgeChunk>(
    "knowledgeChunks",
    (chunk) =>
      chunk.orgId === orgId ||
      knowledgeBaseIds.has(chunk.knowledgeBaseId) ||
      knowledgeSourceIds.has(chunk.sourceId),
  );
  remove<E.KnowledgeSource>(
    "knowledgeSources",
    (source) =>
      source.orgId === orgId || knowledgeBaseIds.has(source.knowledgeBaseId),
  );
  remove<E.DeviceAuthorization>(
    "deviceAuthorizations",
    (authorization) =>
      authorization.orgId === orgId || userIds.has(authorization.userId),
  );
  remove<E.ApiKey>("apiKeys", (apiKey) => apiKey.orgId === orgId);
  remove<E.LocalMfaFactor>(
    "localMfaFactors",
    (factor) => factor.orgId === orgId || userIds.has(factor.userId),
  );
  remove<E.LocalMfaChallenge>(
    "localMfaChallenges",
    (challenge) => challenge.orgId === orgId,
  );
  remove<E.LocalPasswordCredential>(
    "localPasswordCredentials",
    (credential) =>
      credential.orgId === orgId || userIds.has(credential.userId),
  );
  remove<E.SamlAuthRequest>(
    "samlAuthRequests",
    (request) => request.orgId === orgId,
  );
  remove<E.UserSession>(
    "userSessions",
    (session) => session.orgId === orgId || userIds.has(session.userId),
  );
  remove<E.ServiceAccount>(
    "serviceAccounts",
    (account) => account.orgId === orgId,
  );
  remove<E.GroupMembership>(
    "groupMemberships",
    (membership) =>
      membership.orgId === orgId ||
      groupIds.has(membership.groupId) ||
      userIds.has(membership.userId),
  );
  remove<E.CollaborationChannel>(
    "collaborationChannels",
    (channel) =>
      channel.orgId === orgId ||
      workspaceIds.has(channel.workspaceId) ||
      userIds.has(channel.userId),
  );
  remove<E.UserNotification>(
    "userNotifications",
    (notification) =>
      notification.orgId === orgId || userIds.has(notification.userId),
  );
  remove<E.NotificationDeliveryChannel>(
    "notificationDeliveryChannels",
    (channel) => channel.orgId === orgId || userIds.has(channel.userId),
  );
  remove<E.WebhookSubscription>(
    "webhookSubscriptions",
    (subscription) => subscription.orgId === orgId,
  );
  remove<E.KnowledgeBase>(
    "knowledgeBases",
    (base) => base.orgId === orgId || workspaceIds.has(base.workspaceId),
  );
  remove<E.FileObject>("fileObjects", (file) => file.orgId === orgId);
  remove<E.PromptTemplate>(
    "promptTemplates",
    (template) => template.orgId === orgId,
  );
  remove<E.WorkspaceFolder>(
    "workspaceFolders",
    (folder) => folder.orgId === orgId,
  );
  remove<E.ChatTag>("chatTags", (tag) => tag.orgId === orgId);
  remove<E.Chat>("chats", (chat) => chat.orgId === orgId);
  remove<E.AgentVersion>(
    "agentVersions",
    (version) =>
      version.orgId === orgId ||
      agentIds.has(version.agentId) ||
      modelIds.has(version.baseModelId),
  );
  remove<E.Agent>("agents", (agent) => agent.orgId === orgId);
  remove<E.EvalSuite>(
    "evalSuites",
    (suite) => suite.orgId === orgId || agentIds.has(suite.agentId),
  );
  remove<E.ToolOperation>(
    "toolOperations",
    (operation) =>
      operation.orgId === orgId || toolConnectorIds.has(operation.connectorId),
  );
  remove<E.ToolConnector>(
    "toolConnectors",
    (connector) => connector.orgId === orgId,
  );
  remove<E.BaseModel>(
    "models",
    (model) => modelIds.has(model.id) || providerIds.has(model.providerId),
  );
  remove<E.ProviderInstance>(
    "providers",
    (provider) => provider.orgId === orgId,
  );
  remove<E.VoiceProfile>("voiceProfiles", (profile) => profile.orgId === orgId);
  remove<E.QuotaBucket>("quotaBuckets", (bucket) => bucket.orgId === orgId);
  remove<E.BillingPlan>("billingPlans", (plan) => plan.orgId === orgId);
  remove<E.BillingEventReceipt>(
    "billingEventReceipts",
    (receipt) => receipt.orgId === orgId,
  );
  remove<E.RetentionPolicy>(
    "retentionPolicies",
    (policy) => policy.orgId === orgId,
  );
  remove<E.SsoOidcSettings>(
    "ssoOidcSettings",
    (settings) => settings.orgId === orgId,
  );
  remove<E.AuditExportIdempotencyReceipt>(
    "auditExportIdempotencyReceipts",
    (receipt) => receipt.orgId === orgId,
  );
  remove<E.AuditExportAttempt>(
    "auditExportAttempts",
    (attempt) => attempt.orgId === orgId,
  );
  remove<E.AuditExportJob>("auditExportJobs", (job) => job.orgId === orgId);
  remove<E.AuditExportDestination>(
    "auditExportDestinations",
    (destination) => destination.orgId === orgId,
  );
  remove<E.AuditIntegrityCheckpoint>(
    "auditIntegrityCheckpoints",
    (checkpoint) => checkpoint.orgId === orgId,
  );
  remove<E.AuditIntegrityRecord>(
    "auditIntegrityRecords",
    (record) => record.orgId === orgId,
  );
  remove<E.AuditIntegrityTenantHead>(
    "auditIntegrityTenantHeads",
    (head) => head.orgId === orgId,
  );
  remove<E.AuditLog>("auditLogs", (log) => log.orgId === orgId);
  remove<E.Group>("groups", (group) => group.orgId === orgId);
  remove<E.User>("users", (user) => user.orgId === orgId);
  remove<E.Workspace>("workspaces", (workspace) => workspace.orgId === orgId);
  remove<E.Organization>("organizations", (organization) =>
    orgIds.has(organization.id),
  );

  return {
    organizationDeleted: (counts.organizations ?? 0) > 0,
    recordCounts: counts,
  };
}
