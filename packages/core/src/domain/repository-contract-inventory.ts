export const ROMEO_REPOSITORY_METHOD_NAMES = [
  "transaction",
  "getCurrentUser",
  "listUsers",
  "createUser",
  "updateUser",
  "listGroups",
  "getGroup",
  "createGroup",
  "updateGroup",
  "deleteGroup",
  "listGroupMemberships",
  "createGroupMembership",
  "deleteGroupMembership",
  "getSsoOidcSettings",
  "upsertSsoOidcSettings",
  "getSystemSetting",
  "listSystemSettings",
  "upsertSystemSetting",
  "listAllOrganizations",
  "listOrganizations",
  "getOrganization",
  "createOrganization",
  "updateOrganization",
  "listWorkspaces",
  "getWorkspace",
  "createWorkspace",
  "updateWorkspace",
  "purgeTenantData",
  "listApiKeys",
  "getApiKey",
  "getApiKeyByHash",
  "createApiKey",
  "updateApiKey",
  "listDeviceAuthorizations",
  "getDeviceAuthorization",
  "getDeviceAuthorizationByRefreshHash",
  "createDeviceAuthorization",
  "updateDeviceAuthorization",
  "listUserSessions",
  "getUserSession",
  "getUserSessionByHash",
  "createUserSession",
  "updateUserSession",
  "getLocalPasswordCredentialByUserId",
  "getLocalPasswordCredentialByEmail",
  "createLocalPasswordCredential",
  "updateLocalPasswordCredential",
  "listLocalMfaFactors",
  "listLocalMfaFactorsForOrg",
  "getLocalMfaFactor",
  "createLocalMfaFactor",
  "updateLocalMfaFactor",
  "listServiceAccounts",
  "getServiceAccount",
  "createServiceAccount",
  "updateServiceAccount",
  "listProviders",
  "getProvider",
  "createProvider",
  "listModels",
  "getModel",
  "updateModel",
  "upsertModels",
  "listAgents",
  "createAgent",
  "updateAgent",
  "getAgent",
  "listAgentKnowledgeBindings",
  "upsertAgentKnowledgeBinding",
  "listAgentToolBindings",
  "upsertAgentToolBinding",
  "listAgentVersions",
  "getAgentVersion",
  "createAgentVersion",
  "listEvalSuites",
  "getEvalSuite",
  "createEvalSuite",
  "listEvalCases",
  "createEvalCases",
  "listEvalRuns",
  "getEvalRun",
  "createEvalRun",
  "getEvalRunResult",
  "listEvalRunResults",
  "createEvalRunResults",
  "listEvalResultHumanRatings",
  "getEvalResultHumanRating",
  "upsertEvalResultHumanRating",
  "listChats",
  "createChat",
  "updateChat",
  "getChat",
  "listMessages",
  "getMessage",
  "createMessage",
  "deleteMessage",
  "listMessageParts",
  "getMessagePart",
  "createMessageParts",
  "listChatComments",
  "createChatComment",
  "listFileObjects",
  "getFileObject",
  "createFileObject",
  "updateFileObject",
  "listChatTags",
  "listChatTagsForChat",
  "listChatIdsByTag",
  "upsertChatTag",
  "createChatTagAssignment",
  "deleteChatTagAssignment",
  "countChatTagAssignments",
  "deleteChatTag",
  "listCollaborationChannels",
  "getCollaborationChannel",
  "createCollaborationChannel",
  "updateCollaborationChannel",
  "deleteCollaborationChannel",
  "listCollaborationChannelMembers",
  "getCollaborationChannelMember",
  "createCollaborationChannelMember",
  "updateCollaborationChannelMember",
  "deleteCollaborationChannelMembers",
  "listUserNotifications",
  "createUserNotification",
  "updateUserNotification",
  "listNotificationDeliveryChannels",
  "createNotificationDeliveryChannel",
  "listNotificationDeliveries",
  "createNotificationDelivery",
  "updateNotificationDelivery",
  "listKnowledgeBases",
  "createKnowledgeBase",
  "updateKnowledgeBase",
  "getKnowledgeBase",
  "listKnowledgeSources",
  "createKnowledgeSource",
  "updateKnowledgeSource",
  "deleteKnowledgeSource",
  "listKnowledgeChunks",
  "createKnowledgeChunks",
  "deleteKnowledgeChunksForSource",
  "listKnowledgeChunkEmbeddings",
  "searchKnowledgeChunkEmbeddings",
  "upsertKnowledgeChunkEmbeddings",
  "deleteKnowledgeChunkEmbeddingsForSource",
  "listDataConnectors",
  "getDataConnector",
  "createDataConnector",
  "updateDataConnector",
  "listDataConnectorSyncs",
  "createDataConnectorSync",
  "updateDataConnectorSync",
  "listDelegatedOAuthConnections",
  "getDelegatedOAuthConnection",
  "getDelegatedOAuthConnectionByProviderAccount",
  "createDelegatedOAuthConnection",
  "updateDelegatedOAuthConnection",
  "withDelegatedOAuthConnectionRefreshLock",
  "listVoiceProfiles",
  "getVoiceProfile",
  "createVoiceProfile",
  "createRun",
  "getRun",
  "updateRun",
  "appendRunEvents",
  "listRunEvents",
  "listToolCalls",
  "createToolCall",
  "listToolConnectors",
  "createToolConnector",
  "updateToolConnector",
  "listToolOperations",
  "createToolOperations",
  "updateToolOperation",
  "listAuditLogs",
  "createAuditLog",
  "deleteAuditLogsBefore",
  "getDataDeletionPlan",
  "deleteDataForResource",
  "listUsageEvents",
  "createUsageEvent",
  "updateUsageEvent",
  "listBackgroundJobs",
  "createBackgroundJob",
  "claimBackgroundJob",
  "renewBackgroundJobLease",
  "updateBackgroundJob",
  "listWebhookSubscriptions",
  "createWebhookSubscription",
  "updateWebhookSubscription",
  "getWebhookSubscription",
  "listWebhookDeliveries",
  "createWebhookDelivery",
  "updateWebhookDelivery",
  "listWorkflowDefinitions",
  "getWorkflowDefinition",
  "createWorkflowDefinition",
  "updateWorkflowDefinition",
  "listWorkflowRuns",
  "getWorkflowRun",
  "createWorkflowRun",
  "updateWorkflowRun",
  "getRetentionPolicy",
  "upsertRetentionPolicy",
  "listQuotaBuckets",
  "createQuotaBucket",
  "updateQuotaBucket",
  "deleteQuotaBucket",
  "getBillingPlan",
  "upsertBillingPlan",
  "listResourceGrants",
  "createResourceGrant",
  "deleteResourceGrantsForPrincipal",
  "listPromptTemplates",
  "getPromptTemplate",
  "createPromptTemplate",
  "updatePromptTemplate",
  "deletePromptTemplate",
  "listResourceFavorites",
  "createResourceFavorite",
  "deleteResourceFavorite",
  "listWorkspaceFolders",
  "getWorkspaceFolder",
  "createWorkspaceFolder",
  "updateWorkspaceFolder",
  "deleteWorkspaceFolder",
  "listWorkspaceFolderItems",
  "createWorkspaceFolderItem",
  "deleteWorkspaceFolderItem",
] as const;

export type RomeoRepositoryMethodName =
  (typeof ROMEO_REPOSITORY_METHOD_NAMES)[number];

export type RepositoryMethodDomain =
  | "agent"
  | "audit"
  | "billing"
  | "chat"
  | "collaboration"
  | "connector"
  | "eval"
  | "file"
  | "governance"
  | "identity"
  | "job"
  | "knowledge"
  | "notification"
  | "provider"
  | "quota"
  | "run"
  | "settings"
  | "tenancy"
  | "tool"
  | "transaction"
  | "usage"
  | "voice"
  | "webhook"
  | "workflow";

export type RepositoryMethodOperation =
  | "append"
  | "count"
  | "create"
  | "delete"
  | "get"
  | "list"
  | "search"
  | "transaction"
  | "update"
  | "upsert";

export type RepositoryTransactionRequirement =
  | "read_only"
  | "single_record_write"
  | "batch_write"
  | "multi_record_lifecycle_write";

export type RepositoryAuditImpact =
  | "content"
  | "governance"
  | "none"
  | "operational_metadata"
  | "security"
  | "usage";

export interface RepositoryMethodInventory {
  method: RomeoRepositoryMethodName;
  domain: RepositoryMethodDomain;
  operation: RepositoryMethodOperation;
  transaction: RepositoryTransactionRequirement;
  authorizationCaller: string;
  auditImpact: RepositoryAuditImpact;
}

export const repositoryContractInventory: RepositoryMethodInventory[] =
  ROMEO_REPOSITORY_METHOD_NAMES.map((method) => {
    const domain = domainForMethod(method);
    return {
      method,
      domain,
      operation: operationForMethod(method),
      transaction: transactionForMethod(method),
      authorizationCaller: authorizationCallerForDomain(domain),
      auditImpact: auditImpactForDomain(domain),
    };
  });

function domainForMethod(
  method: RomeoRepositoryMethodName,
): RepositoryMethodDomain {
  if (method === "transaction") return "transaction";
  if (
    includesAny(method, [
      "AgentKnowledgeBinding",
      "AgentToolBinding",
      "AgentVersion",
      "Agent",
    ])
  )
    return "agent";
  if (includesAny(method, ["SystemSetting"])) return "settings";
  if (
    includesAny(method, [
      "ApiKey",
      "CurrentUser",
      "DeviceAuthorization",
      "Group",
      "LocalMfaFactor",
      "LocalPasswordCredential",
      "ServiceAccount",
      "SsoOidcSettings",
      "UserSession",
      "User",
    ])
  )
    return "identity";
  if (method === "purgeTenantData") return "tenancy";
  if (
    includesAny(method, [
      "PromptTemplate",
      "ResourceFavorite",
      "WorkspaceFolder",
    ])
  )
    return "collaboration";
  if (includesAny(method, ["Organization", "Workspace"])) return "tenancy";
  if (includesAny(method, ["Provider", "Model"])) return "provider";
  if (includesAny(method, ["Eval"])) return "eval";
  if (includesAny(method, ["FileObject"])) return "file";
  if (includesAny(method, ["Chat", "Message", "CollaborationChannel"]))
    return "chat";
  if (includesAny(method, ["Notification"])) return "notification";
  if (includesAny(method, ["Knowledge"])) return "knowledge";
  if (includesAny(method, ["DataConnector", "DelegatedOAuthConnection"]))
    return "connector";
  if (includesAny(method, ["Voice"])) return "voice";
  if (includesAny(method, ["Tool"])) return "tool";
  if (includesAny(method, ["RunEvent", "Run"])) return "run";
  if (includesAny(method, ["AuditLog"])) return "audit";
  if (
    includesAny(method, [
      "DataDeletion",
      "DataForResource",
      "RetentionPolicy",
      "ResourceGrant",
    ])
  )
    return "governance";
  if (includesAny(method, ["UsageEvent"])) return "usage";
  if (includesAny(method, ["BackgroundJob"])) return "job";
  if (includesAny(method, ["Webhook"])) return "webhook";
  if (includesAny(method, ["Workflow"])) return "workflow";
  if (includesAny(method, ["BillingPlan"])) return "billing";
  if (includesAny(method, ["QuotaBucket"])) return "quota";
  return exhaustiveDomain(method);
}

function operationForMethod(
  method: RomeoRepositoryMethodName,
): RepositoryMethodOperation {
  if (method === "transaction") return "transaction";
  if (method.startsWith("append")) return "append";
  if (method.startsWith("count")) return "count";
  if (method.startsWith("create")) return "create";
  if (method.startsWith("delete")) return "delete";
  if (method.startsWith("purge")) return "delete";
  if (method.startsWith("get")) return "get";
  if (method.startsWith("list")) return "list";
  if (method.startsWith("claim")) return "update";
  if (method.startsWith("renew")) return "update";
  if (method.startsWith("search")) return "search";
  if (method.startsWith("update")) return "update";
  if (method.startsWith("upsert")) return "upsert";
  if (method.startsWith("with")) return "transaction";
  return exhaustiveOperation(method);
}

function transactionForMethod(
  method: RomeoRepositoryMethodName,
): RepositoryTransactionRequirement {
  if (method === "transaction") return "multi_record_lifecycle_write";
  const operation = operationForMethod(method);
  if (operation === "transaction") return "multi_record_lifecycle_write";
  if (
    operation === "count" ||
    operation === "get" ||
    operation === "list" ||
    operation === "search"
  )
    return "read_only";
  if (
    includesAny(method, [
      "AuditLogsBefore",
      "DataForResource",
      "EvalCases",
      "EvalRunResults",
      "KnowledgeChunkEmbeddings",
      "KnowledgeChunks",
      "CollaborationChannelMembers",
      "MessageParts",
      "RunEvents",
      "ToolOperations",
    ])
  ) {
    return "batch_write";
  }
  if (operation === "delete") return "multi_record_lifecycle_write";
  return "single_record_write";
}

function authorizationCallerForDomain(domain: RepositoryMethodDomain): string {
  if (domain === "transaction") return "repository_boundary_service";
  return `${domain}_service`;
}

function auditImpactForDomain(
  domain: RepositoryMethodDomain,
): RepositoryAuditImpact {
  if (domain === "transaction") return "operational_metadata";
  if (domain === "identity") return "security";
  if (domain === "settings") return "security";
  if (domain === "audit" || domain === "governance") return "governance";
  if (domain === "billing" || domain === "quota" || domain === "usage")
    return "usage";
  if (
    domain === "connector" ||
    domain === "job" ||
    domain === "notification" ||
    domain === "provider" ||
    domain === "tool" ||
    domain === "webhook"
  ) {
    return "operational_metadata";
  }
  if (
    domain === "agent" ||
    domain === "chat" ||
    domain === "collaboration" ||
    domain === "eval" ||
    domain === "file" ||
    domain === "knowledge" ||
    domain === "run" ||
    domain === "voice" ||
    domain === "workflow"
  ) {
    return "content";
  }
  return "none";
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function exhaustiveDomain(method: string): RepositoryMethodDomain {
  throw new Error(`Unclassified repository method domain: ${method}`);
}

function exhaustiveOperation(method: string): RepositoryMethodOperation {
  throw new Error(`Unclassified repository method operation: ${method}`);
}
