import { describe, expect, it } from "vitest";

import {
  composeRepositoryFragments,
  createAccessRepositoryFragment,
  createAgentEvalRepositoryFragment,
  createAuthCredentialRepositoryFragment,
  createChatRepositoryFragment,
  createChatTagRepositoryFragment,
  createCollaborationRepositoryFragment,
  createDataConnectorRepositoryFragment,
  createDataDeletionRepositoryFragment,
  createFileRepositoryFragment,
  createGovernanceBillingRepositoryFragment,
  createKnowledgeEmbeddingRepositoryFragment,
  createKnowledgeRepositoryFragment,
  createNotificationRepositoryFragment,
  createCollaborationChannelRepositoryFragment,
  createOperationalRepositoryFragment,
  createProviderRepositoryFragment,
  createRunRepositoryFragment,
  createTenantIdentityRepositoryFragment,
  createToolConnectorRepositoryFragment,
  createVoiceRepositoryFragment,
  createWebhookRepositoryFragment,
  createWorkflowRepositoryFragment,
} from "./repository-fragments";

describe("repository fragment composition", () => {
  it("exposes the pgvector knowledge embedding methods as a composable fragment", () => {
    const fragment = createKnowledgeEmbeddingRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "deleteKnowledgeChunkEmbeddingsForSource",
      "listKnowledgeChunkEmbeddings",
      "searchKnowledgeChunkEmbeddings",
      "upsertKnowledgeChunkEmbeddings",
    ]);
  });

  it("exposes the knowledge base and chunk methods as a composable fragment", () => {
    const fragment = createKnowledgeRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createKnowledgeBase",
      "createKnowledgeChunks",
      "createKnowledgeSource",
      "deleteKnowledgeChunksForSource",
      "deleteKnowledgeSource",
      "getKnowledgeBase",
      "listKnowledgeBases",
      "listKnowledgeChunks",
      "listKnowledgeSources",
      "updateKnowledgeBase",
      "updateKnowledgeSource",
    ]);
  });

  it("exposes the tenant identity methods as a composable fragment", () => {
    const fragment = createTenantIdentityRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createGroup",
      "createGroupMembership",
      "createOrganization",
      "createUser",
      "createWorkspace",
      "deleteGroup",
      "deleteGroupMembership",
      "getCurrentUser",
      "getGroup",
      "getOrganization",
      "getSsoOidcSettings",
      "getWorkspace",
      "listAllOrganizations",
      "listGroupMemberships",
      "listGroups",
      "listOrganizations",
      "listUsers",
      "listWorkspaces",
      "purgeTenantData",
      "updateGroup",
      "updateOrganization",
      "updateUser",
      "updateWorkspace",
      "upsertSsoOidcSettings",
    ]);
  });

  it("exposes the auth credential methods as a composable fragment", () => {
    const fragment = createAuthCredentialRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createApiKey",
      "createDeviceAuthorization",
      "createLocalMfaFactor",
      "createLocalPasswordCredential",
      "createServiceAccount",
      "createUserSession",
      "getApiKey",
      "getApiKeyByHash",
      "getDeviceAuthorization",
      "getDeviceAuthorizationByRefreshHash",
      "getLocalMfaFactor",
      "getLocalPasswordCredentialByEmail",
      "getLocalPasswordCredentialByUserId",
      "getServiceAccount",
      "getUserSession",
      "getUserSessionByHash",
      "listApiKeys",
      "listDeviceAuthorizations",
      "listLocalMfaFactors",
      "listLocalMfaFactorsForOrg",
      "listServiceAccounts",
      "listUserSessions",
      "updateApiKey",
      "updateDeviceAuthorization",
      "updateLocalMfaFactor",
      "updateLocalPasswordCredential",
      "updateServiceAccount",
      "updateUserSession",
    ]);
  });

  it("exposes the provider catalog methods as a composable fragment", () => {
    const fragment = createProviderRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createProvider",
      "getModel",
      "getProvider",
      "listModels",
      "listProviders",
      "updateModel",
      "upsertModels",
    ]);
  });

  it("exposes the agent and eval methods as a composable fragment", () => {
    const fragment = createAgentEvalRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createAgent",
      "createAgentVersion",
      "createEvalCases",
      "createEvalRun",
      "createEvalRunResults",
      "createEvalSuite",
      "getAgent",
      "getAgentVersion",
      "getEvalResultHumanRating",
      "getEvalRun",
      "getEvalRunResult",
      "getEvalSuite",
      "listAgentKnowledgeBindings",
      "listAgentToolBindings",
      "listAgentVersions",
      "listAgents",
      "listEvalCases",
      "listEvalResultHumanRatings",
      "listEvalRunResults",
      "listEvalRuns",
      "listEvalSuites",
      "updateAgent",
      "upsertAgentKnowledgeBinding",
      "upsertAgentToolBinding",
      "upsertEvalResultHumanRating",
    ]);
  });

  it("exposes the chat and message methods as a composable fragment", () => {
    const fragment = createChatRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createChat",
      "createChatComment",
      "createMessage",
      "createMessageParts",
      "deleteMessage",
      "getChat",
      "getMessage",
      "getMessagePart",
      "listChatComments",
      "listChats",
      "listMessageParts",
      "listMessages",
      "updateChat",
    ]);
  });

  it("exposes the chat tag methods as a composable fragment", () => {
    const fragment = createChatTagRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "countChatTagAssignments",
      "createChatTagAssignment",
      "deleteChatTag",
      "deleteChatTagAssignment",
      "listChatIdsByTag",
      "listChatTags",
      "listChatTagsForChat",
      "upsertChatTag",
    ]);
  });

  it("exposes the file object methods as a composable fragment", () => {
    const fragment = createFileRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createFileObject",
      "getFileObject",
      "listFileObjects",
      "updateFileObject",
    ]);
  });

  it("exposes the Collaboration channel methods as a composable fragment", () => {
    const fragment = createCollaborationChannelRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createCollaborationChannel",
      "createCollaborationChannelMember",
      "deleteCollaborationChannel",
      "deleteCollaborationChannelMembers",
      "getCollaborationChannel",
      "getCollaborationChannelMember",
      "listCollaborationChannelMembers",
      "listCollaborationChannels",
      "updateCollaborationChannel",
      "updateCollaborationChannelMember",
    ]);
  });

  it("exposes the run and tool-call methods as a composable fragment", () => {
    const fragment = createRunRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "appendRunEvents",
      "createRun",
      "createToolCall",
      "getRun",
      "listRunEvents",
      "listToolCalls",
      "updateRun",
    ]);
  });

  it("exposes the tool connector methods as a composable fragment", () => {
    const fragment = createToolConnectorRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createToolConnector",
      "createToolOperations",
      "listToolConnectors",
      "listToolOperations",
      "updateToolConnector",
      "updateToolOperation",
    ]);
  });

  it("exposes the data connector methods as a composable fragment", () => {
    const fragment = createDataConnectorRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createDataConnector",
      "createDataConnectorSync",
      "getDataConnector",
      "listDataConnectorSyncs",
      "listDataConnectors",
      "updateDataConnector",
      "updateDataConnectorSync",
    ]);
  });

  it("exposes the operational audit, usage, and job methods as a composable fragment", () => {
    const fragment = createOperationalRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "claimBackgroundJob",
      "createAuditLog",
      "createBackgroundJob",
      "createUsageEvent",
      "deleteAuditLogsBefore",
      "getSystemSetting",
      "listAuditLogs",
      "listBackgroundJobs",
      "listSystemSettings",
      "listUsageEvents",
      "renewBackgroundJobLease",
      "updateBackgroundJob",
      "updateUsageEvent",
      "upsertSystemSetting",
    ]);
  });

  it("exposes the webhook subscription and delivery methods as a composable fragment", () => {
    const fragment = createWebhookRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createWebhookDelivery",
      "createWebhookSubscription",
      "getWebhookSubscription",
      "listWebhookDeliveries",
      "listWebhookSubscriptions",
      "updateWebhookDelivery",
      "updateWebhookSubscription",
    ]);
  });

  it("exposes the workflow definition and run methods as a composable fragment", () => {
    const fragment = createWorkflowRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createWorkflowDefinition",
      "createWorkflowRun",
      "getWorkflowDefinition",
      "getWorkflowRun",
      "listWorkflowDefinitions",
      "listWorkflowRuns",
      "updateWorkflowDefinition",
      "updateWorkflowRun",
    ]);
  });

  it("exposes governance, billing, and quota methods as a composable fragment", () => {
    const fragment = createGovernanceBillingRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createQuotaBucket",
      "deleteQuotaBucket",
      "getBillingPlan",
      "getRetentionPolicy",
      "listQuotaBuckets",
      "updateQuotaBucket",
      "upsertBillingPlan",
      "upsertRetentionPolicy",
    ]);
  });

  it("exposes notification methods as a composable fragment", () => {
    const fragment = createNotificationRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createNotificationDelivery",
      "createNotificationDeliveryChannel",
      "createUserNotification",
      "listNotificationDeliveries",
      "listNotificationDeliveryChannels",
      "listUserNotifications",
      "updateNotificationDelivery",
      "updateUserNotification",
    ]);
  });

  it("exposes collaboration artifact methods as a composable fragment", () => {
    const fragment = createCollaborationRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createPromptTemplate",
      "createResourceFavorite",
      "createWorkspaceFolder",
      "createWorkspaceFolderItem",
      "deletePromptTemplate",
      "deleteResourceFavorite",
      "deleteWorkspaceFolder",
      "deleteWorkspaceFolderItem",
      "getPromptTemplate",
      "getWorkspaceFolder",
      "listPromptTemplates",
      "listResourceFavorites",
      "listWorkspaceFolderItems",
      "listWorkspaceFolders",
      "updatePromptTemplate",
      "updateWorkspaceFolder",
    ]);
  });

  it("exposes resource grant access methods as a composable fragment", () => {
    const fragment = createAccessRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createResourceGrant",
      "deleteResourceGrantsForPrincipal",
      "listResourceGrants",
    ]);
  });

  it("exposes voice profile methods as a composable fragment", () => {
    const fragment = createVoiceRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "createVoiceProfile",
      "getVoiceProfile",
      "listVoiceProfiles",
    ]);
  });

  it("exposes governed data deletion methods as a composable fragment", () => {
    const fragment = createDataDeletionRepositoryFragment({} as never);

    expect(Object.keys(fragment).sort()).toEqual([
      "deleteDataForResource",
      "getDataDeletionPlan",
    ]);
  });

  it("composes focused repository fragments and rejects method collisions", async () => {
    const users = { listUsers: async () => ["user_1"] };
    const jobs = { listBackgroundJobs: async () => ["job_1"] };
    const composed = composeRepositoryFragments(users, jobs);

    await expect(composed.listUsers()).resolves.toEqual(["user_1"]);
    await expect(composed.listBackgroundJobs()).resolves.toEqual(["job_1"]);
    expect(() =>
      composeRepositoryFragments(users, { listUsers: async () => [] }),
    ).toThrow("Repository fragment collision: listUsers");
  });
});
