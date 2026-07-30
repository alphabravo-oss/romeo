import { PgAccessRepository } from "./access-repository";
import { PgAgentRepository } from "./agent-repository";
import { PgAuthCredentialRepository } from "./auth-credential-repository";
import { PgChatRepository } from "./chat-repository";
import { PgChatTagRepository } from "./chat-tag-repository";
import { PgCollaborationRepository } from "./collaboration-repository";
import { PgDataConnectorRepository } from "./data-connector-repository";
import { PgDataDeletionRepository } from "./data-deletion-repository";
import { PgDelegatedOAuthRepository } from "./delegated-oauth-repository";
import { PgEvalRepository } from "./eval-repository";
import { PgFileRepository } from "./file-repository";
import { PgGovernanceBillingRepository } from "./governance-billing-repository";
import { PgIdentityRepository } from "./identity-repository";
import { PgKnowledgeEmbeddingRepository } from "./knowledge-embedding-repository";
import { PgKnowledgeRepository } from "./knowledge-repository";
import { PgNotificationRepository } from "./notification-repository";
import { PgCollaborationChannelRepository } from "./collaboration-channel-repository";
import { PgOperationalRepository } from "./operational-repository";
import { PgProviderRepository } from "./provider-repository";
import { PgRunRepository } from "./run-repository";
import { PgTenantRepository } from "./tenant-repository";
import { PgTenantPurgeRepository } from "./tenant-purge-repository";
import { PgToolConnectorRepository } from "./tool-connector-repository";
import { PgVoiceRepository } from "./voice-repository";
import { PgWebhookRepository } from "./webhook-repository";
import { PgWorkflowRepository } from "./workflow-repository";

export type RepositoryFragment = Record<
  string,
  (...args: never[]) => Promise<unknown>
>;

export type KnowledgeEmbeddingRepositoryFragment = Pick<
  PgKnowledgeEmbeddingRepository,
  | "deleteKnowledgeChunkEmbeddingsForSource"
  | "listKnowledgeChunkEmbeddings"
  | "searchKnowledgeChunkEmbeddings"
  | "upsertKnowledgeChunkEmbeddings"
>;

export type KnowledgeRepositoryFragment = Pick<
  PgKnowledgeRepository,
  | "createKnowledgeBase"
  | "createKnowledgeChunks"
  | "createKnowledgeSource"
  | "deleteKnowledgeChunksForSource"
  | "deleteKnowledgeSource"
  | "getKnowledgeBase"
  | "listKnowledgeBases"
  | "listKnowledgeChunks"
  | "listKnowledgeSources"
  | "updateKnowledgeBase"
  | "updateKnowledgeSource"
>;

export type TenantIdentityRepositoryFragment = Pick<
  PgIdentityRepository,
  | "createGroup"
  | "createGroupMembership"
  | "createUser"
  | "deleteGroup"
  | "deleteGroupMembership"
  | "getCurrentUser"
  | "getGroup"
  | "getSsoOidcSettings"
  | "listGroupMemberships"
  | "listGroups"
  | "listUsers"
  | "listUsersPage"
  | "updateGroup"
  | "updateUser"
  | "upsertSsoOidcSettings"
> &
  Pick<
    PgTenantRepository,
    | "createOrganization"
    | "createWorkspace"
    | "getOrganization"
    | "getWorkspace"
    | "listAllOrganizations"
    | "listOrganizations"
    | "listWorkspaces"
    | "updateOrganization"
    | "updateWorkspace"
  > &
  Pick<PgTenantPurgeRepository, "purgeTenantData">;

export type AuthCredentialRepositoryFragment = Pick<
  PgAuthCredentialRepository,
  | "createApiKey"
  | "createDeviceAuthorization"
  | "createLocalMfaFactor"
  | "createLocalPasswordCredential"
  | "createServiceAccount"
  | "createUserSession"
  | "getApiKey"
  | "getApiKeyByHash"
  | "getDeviceAuthorization"
  | "getDeviceAuthorizationByRefreshHash"
  | "getLocalMfaFactor"
  | "getLocalPasswordCredentialByEmail"
  | "getLocalPasswordCredentialByUserId"
  | "getServiceAccount"
  | "getUserSession"
  | "getUserSessionByHash"
  | "listApiKeys"
  | "listDeviceAuthorizations"
  | "listLocalMfaFactors"
  | "listLocalMfaFactorsForOrg"
  | "listServiceAccounts"
  | "listUserSessions"
  | "updateApiKey"
  | "updateDeviceAuthorization"
  | "updateLocalMfaFactor"
  | "updateLocalPasswordCredential"
  | "updateServiceAccount"
  | "updateUserSession"
>;

export type ProviderRepositoryFragment = Pick<
  PgProviderRepository,
  | "createProvider"
  | "updateProvider"
  | "getModel"
  | "getProvider"
  | "listModels"
  | "listModelsPage"
  | "listProviders"
  | "updateModel"
  | "upsertModels"
>;

export type AgentEvalRepositoryFragment = Pick<
  PgAgentRepository,
  | "archiveAgent"
  | "createAgent"
  | "createAgentVersion"
  | "deleteManagedModelPreference"
  | "getAgent"
  | "getAgentVersion"
  | "getManagedModelCustomizationPolicy"
  | "getManagedModelPreference"
  | "listAgentKnowledgeBindings"
  | "listAgentToolBindings"
  | "listAgentVersions"
  | "listAgents"
  | "listManagedModelPreferences"
  | "updateAgent"
  | "upsertAgentKnowledgeBinding"
  | "upsertAgentToolBinding"
  | "upsertManagedModelCustomizationPolicy"
  | "upsertManagedModelPreference"
> &
  Pick<
    PgEvalRepository,
    | "createEvalCases"
    | "createEvalRun"
    | "createEvalRunResults"
    | "createEvalSuite"
    | "getEvalRun"
    | "getEvalRunResult"
    | "getEvalResultHumanRating"
    | "getEvalSuite"
    | "listEvalCases"
    | "listEvalResultHumanRatings"
    | "listEvalRunResults"
    | "listEvalRuns"
    | "listEvalRunsForAgents"
    | "listEvalSuites"
    | "listEvalSuitesForAgents"
    | "upsertEvalResultHumanRating"
  >;

export type ChatRepositoryFragment = Pick<
  PgChatRepository,
  | "createChat"
  | "createChatComment"
  | "createQueuedChatTurn"
  | "createMessage"
  | "createMessageParts"
  | "deleteMessage"
  | "getChat"
  | "getMessage"
  | "getMessagePart"
  | "getQueuedChatTurn"
  | "getQueuedChatTurnByIdempotency"
  | "listChatComments"
  | "listChats"
  | "listAuthorizedChatsPage"
  | "listMessageParts"
  | "listMessages"
  | "listQueuedChatTurns"
  | "claimNextQueuedChatTurn"
  | "cancelQueuedChatTurn"
  | "finishQueuedChatTurnLease"
  | "renewQueuedChatTurnLease"
  | "searchChatContent"
  | "updateChat"
  | "updateMessagePart"
  | "updateQueuedChatTurn"
>;

export type ChatTagRepositoryFragment = Pick<
  PgChatTagRepository,
  | "countChatTagAssignments"
  | "createChatTagAssignment"
  | "deleteChatTag"
  | "deleteChatTagAssignment"
  | "listChatIdsByTag"
  | "listChatTags"
  | "listChatTagsForChat"
  | "upsertChatTag"
>;

export type FileRepositoryFragment = Pick<
  PgFileRepository,
  | "createFileObject"
  | "getFileObject"
  | "listFileObjects"
  | "updateFileObject"
  | "listAuthorizedFileObjectsPage"
>;

export type CollaborationChannelRepositoryFragment = Pick<
  PgCollaborationChannelRepository,
  | "createCollaborationChannel"
  | "createCollaborationChannelMember"
  | "deleteCollaborationChannel"
  | "deleteCollaborationChannelMembers"
  | "getCollaborationChannel"
  | "getCollaborationChannelMember"
  | "listCollaborationChannelMembers"
  | "listCollaborationChannels"
  | "updateCollaborationChannel"
  | "updateCollaborationChannelMember"
>;

export type RunRepositoryFragment = Pick<
  PgRunRepository,
  | "appendRunEvents"
  | "createRun"
  | "createToolCall"
  | "finalizeRun"
  | "getRun"
  | "listRuns"
  | "listRunEvents"
  | "listToolCalls"
  | "updateRun"
>;

export type ToolConnectorRepositoryFragment = Pick<
  PgToolConnectorRepository,
  | "createToolConnector"
  | "createToolOperations"
  | "listToolConnectors"
  | "listToolOperations"
  | "listToolOperationsForConnectors"
  | "updateToolConnector"
  | "updateToolOperation"
>;

export type DataConnectorRepositoryFragment = Pick<
  PgDataConnectorRepository,
  | "createDataConnector"
  | "createDataConnectorSync"
  | "getDataConnector"
  | "listDataConnectors"
  | "listDataConnectorSyncs"
  | "updateDataConnector"
  | "updateDataConnectorSync"
>;

export type DelegatedOAuthRepositoryFragment = Pick<
  PgDelegatedOAuthRepository,
  | "createDelegatedOAuthConnection"
  | "getDelegatedOAuthConnection"
  | "getDelegatedOAuthConnectionByProviderAccount"
  | "listDelegatedOAuthConnections"
  | "updateDelegatedOAuthConnection"
>;

export type OperationalRepositoryFragment = Pick<
  PgOperationalRepository,
  | "createAuditLog"
  | "createBackgroundJob"
  | "claimBackgroundJob"
  | "createUsageEvent"
  | "deleteAuditLogsBefore"
  | "getSystemSetting"
  | "listAuditLogs"
  | "listBackgroundJobs"
  | "listSystemSettings"
  | "listUsageEvents"
  | "renewBackgroundJobLease"
  | "updateBackgroundJobWithLease"
  | "upsertSystemSetting"
  | "updateBackgroundJob"
  | "updateUsageEvent"
>;

export type WebhookRepositoryFragment = Pick<
  PgWebhookRepository,
  | "createWebhookDelivery"
  | "createWebhookSubscription"
  | "getWebhookSubscription"
  | "listWebhookDeliveries"
  | "listWebhookSubscriptions"
  | "updateWebhookDelivery"
  | "updateWebhookSubscription"
>;

export type WorkflowRepositoryFragment = Pick<
  PgWorkflowRepository,
  | "createWorkflowDefinition"
  | "createWorkflowRun"
  | "getWorkflowDefinition"
  | "getWorkflowRun"
  | "listWorkflowDefinitions"
  | "listWorkflowRuns"
  | "updateWorkflowDefinition"
  | "updateWorkflowRun"
>;

export type GovernanceBillingRepositoryFragment = Pick<
  PgGovernanceBillingRepository,
  | "createQuotaBucket"
  | "deleteQuotaBucket"
  | "getBillingPlan"
  | "getRetentionPolicy"
  | "listQuotaBuckets"
  | "updateQuotaBucket"
  | "upsertBillingPlan"
  | "upsertRetentionPolicy"
>;

export type NotificationRepositoryFragment = Pick<
  PgNotificationRepository,
  | "createNotificationDelivery"
  | "createNotificationDeliveryChannel"
  | "createUserNotification"
  | "listNotificationDeliveries"
  | "listFailedNotificationDeliveries"
  | "listNotificationDeliveryChannels"
  | "listUserNotifications"
  | "updateNotificationDelivery"
  | "updateUserNotification"
>;

export type CollaborationRepositoryFragment = Pick<
  PgCollaborationRepository,
  | "createPromptTemplate"
  | "createResourceFavorite"
  | "createWorkspaceFolder"
  | "createWorkspaceFolderItem"
  | "deletePromptTemplate"
  | "deleteResourceFavorite"
  | "deleteWorkspaceFolder"
  | "deleteWorkspaceFolderItem"
  | "getPromptTemplate"
  | "getWorkspaceFolder"
  | "listPromptTemplates"
  | "listAuthorizedPromptTemplatesPage"
  | "listResourceFavorites"
  | "listWorkspaceFolderItems"
  | "listWorkspaceFolders"
  | "updatePromptTemplate"
  | "updateWorkspaceFolder"
>;

export type AccessRepositoryFragment = Pick<
  PgAccessRepository,
  | "createResourceGrant"
  | "deleteResourceGrant"
  | "deleteResourceGrantsForPrincipal"
  | "listResourceGrants"
>;

export type VoiceRepositoryFragment = Pick<
  PgVoiceRepository,
  "createVoiceProfile" | "getVoiceProfile" | "listVoiceProfiles"
>;

export type DataDeletionRepositoryFragment = Pick<
  PgDataDeletionRepository,
  "deleteDataForResource" | "getDataDeletionPlan"
>;
