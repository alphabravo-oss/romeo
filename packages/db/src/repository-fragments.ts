import type { RomeoDatabase } from "./client";
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
  | "getModel"
  | "getProvider"
  | "listModels"
  | "listProviders"
  | "updateModel"
  | "upsertModels"
>;

export type AgentEvalRepositoryFragment = Pick<
  PgAgentRepository,
  | "createAgent"
  | "createAgentVersion"
  | "getAgent"
  | "getAgentVersion"
  | "listAgentKnowledgeBindings"
  | "listAgentToolBindings"
  | "listAgentVersions"
  | "listAgents"
  | "updateAgent"
  | "upsertAgentKnowledgeBinding"
  | "upsertAgentToolBinding"
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
    | "listEvalSuites"
    | "upsertEvalResultHumanRating"
  >;

export type ChatRepositoryFragment = Pick<
  PgChatRepository,
  | "createChat"
  | "createChatComment"
  | "createMessage"
  | "createMessageParts"
  | "deleteMessage"
  | "getChat"
  | "getMessage"
  | "getMessagePart"
  | "listChatComments"
  | "listChats"
  | "listMessageParts"
  | "listMessages"
  | "updateChat"
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
  "createFileObject" | "getFileObject" | "listFileObjects" | "updateFileObject"
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
  | "getRun"
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
  | "listResourceFavorites"
  | "listWorkspaceFolderItems"
  | "listWorkspaceFolders"
  | "updatePromptTemplate"
  | "updateWorkspaceFolder"
>;

export type AccessRepositoryFragment = Pick<
  PgAccessRepository,
  | "createResourceGrant"
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

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export function createKnowledgeEmbeddingRepositoryFragment(
  db: RomeoDatabase,
): KnowledgeEmbeddingRepositoryFragment {
  const repository = new PgKnowledgeEmbeddingRepository(db);
  return {
    deleteKnowledgeChunkEmbeddingsForSource:
      repository.deleteKnowledgeChunkEmbeddingsForSource.bind(repository),
    listKnowledgeChunkEmbeddings:
      repository.listKnowledgeChunkEmbeddings.bind(repository),
    searchKnowledgeChunkEmbeddings:
      repository.searchKnowledgeChunkEmbeddings.bind(repository),
    upsertKnowledgeChunkEmbeddings:
      repository.upsertKnowledgeChunkEmbeddings.bind(repository),
  };
}

export function createKnowledgeRepositoryFragment(
  db: RomeoDatabase,
): KnowledgeRepositoryFragment {
  const repository = new PgKnowledgeRepository(db);
  return {
    createKnowledgeBase: repository.createKnowledgeBase.bind(repository),
    createKnowledgeChunks: repository.createKnowledgeChunks.bind(repository),
    createKnowledgeSource: repository.createKnowledgeSource.bind(repository),
    deleteKnowledgeChunksForSource:
      repository.deleteKnowledgeChunksForSource.bind(repository),
    deleteKnowledgeSource: repository.deleteKnowledgeSource.bind(repository),
    getKnowledgeBase: repository.getKnowledgeBase.bind(repository),
    listKnowledgeBases: repository.listKnowledgeBases.bind(repository),
    listKnowledgeChunks: repository.listKnowledgeChunks.bind(repository),
    listKnowledgeSources: repository.listKnowledgeSources.bind(repository),
    updateKnowledgeBase: repository.updateKnowledgeBase.bind(repository),
    updateKnowledgeSource: repository.updateKnowledgeSource.bind(repository),
  };
}

export function createTenantIdentityRepositoryFragment(
  db: RomeoDatabase,
): TenantIdentityRepositoryFragment {
  const identity = new PgIdentityRepository(db);
  const tenancy = new PgTenantRepository(db);
  const purge = new PgTenantPurgeRepository(db);
  return {
    createGroup: identity.createGroup.bind(identity),
    createGroupMembership: identity.createGroupMembership.bind(identity),
    createOrganization: tenancy.createOrganization.bind(tenancy),
    createUser: identity.createUser.bind(identity),
    createWorkspace: tenancy.createWorkspace.bind(tenancy),
    deleteGroup: identity.deleteGroup.bind(identity),
    deleteGroupMembership: identity.deleteGroupMembership.bind(identity),
    getCurrentUser: identity.getCurrentUser.bind(identity),
    getGroup: identity.getGroup.bind(identity),
    getOrganization: tenancy.getOrganization.bind(tenancy),
    getSsoOidcSettings: identity.getSsoOidcSettings.bind(identity),
    getWorkspace: tenancy.getWorkspace.bind(tenancy),
    listAllOrganizations: tenancy.listAllOrganizations.bind(tenancy),
    listGroupMemberships: identity.listGroupMemberships.bind(identity),
    listGroups: identity.listGroups.bind(identity),
    listOrganizations: tenancy.listOrganizations.bind(tenancy),
    listUsers: identity.listUsers.bind(identity),
    listWorkspaces: tenancy.listWorkspaces.bind(tenancy),
    purgeTenantData: purge.purgeTenantData.bind(purge),
    updateGroup: identity.updateGroup.bind(identity),
    updateOrganization: tenancy.updateOrganization.bind(tenancy),
    updateUser: identity.updateUser.bind(identity),
    updateWorkspace: tenancy.updateWorkspace.bind(tenancy),
    upsertSsoOidcSettings: identity.upsertSsoOidcSettings.bind(identity),
  };
}

export function createAuthCredentialRepositoryFragment(
  db: RomeoDatabase,
): AuthCredentialRepositoryFragment {
  const repository = new PgAuthCredentialRepository(db);
  return {
    createApiKey: repository.createApiKey.bind(repository),
    createDeviceAuthorization:
      repository.createDeviceAuthorization.bind(repository),
    createLocalMfaFactor: repository.createLocalMfaFactor.bind(repository),
    createLocalPasswordCredential:
      repository.createLocalPasswordCredential.bind(repository),
    createServiceAccount: repository.createServiceAccount.bind(repository),
    createUserSession: repository.createUserSession.bind(repository),
    getApiKey: repository.getApiKey.bind(repository),
    getApiKeyByHash: repository.getApiKeyByHash.bind(repository),
    getDeviceAuthorization: repository.getDeviceAuthorization.bind(repository),
    getDeviceAuthorizationByRefreshHash:
      repository.getDeviceAuthorizationByRefreshHash.bind(repository),
    getLocalMfaFactor: repository.getLocalMfaFactor.bind(repository),
    getLocalPasswordCredentialByEmail:
      repository.getLocalPasswordCredentialByEmail.bind(repository),
    getLocalPasswordCredentialByUserId:
      repository.getLocalPasswordCredentialByUserId.bind(repository),
    getServiceAccount: repository.getServiceAccount.bind(repository),
    getUserSession: repository.getUserSession.bind(repository),
    getUserSessionByHash: repository.getUserSessionByHash.bind(repository),
    listApiKeys: repository.listApiKeys.bind(repository),
    listDeviceAuthorizations:
      repository.listDeviceAuthorizations.bind(repository),
    listLocalMfaFactors: repository.listLocalMfaFactors.bind(repository),
    listLocalMfaFactorsForOrg:
      repository.listLocalMfaFactorsForOrg.bind(repository),
    listServiceAccounts: repository.listServiceAccounts.bind(repository),
    listUserSessions: repository.listUserSessions.bind(repository),
    updateApiKey: repository.updateApiKey.bind(repository),
    updateDeviceAuthorization:
      repository.updateDeviceAuthorization.bind(repository),
    updateLocalMfaFactor: repository.updateLocalMfaFactor.bind(repository),
    updateLocalPasswordCredential:
      repository.updateLocalPasswordCredential.bind(repository),
    updateServiceAccount: repository.updateServiceAccount.bind(repository),
    updateUserSession: repository.updateUserSession.bind(repository),
  };
}

export function createProviderRepositoryFragment(
  db: RomeoDatabase,
): ProviderRepositoryFragment {
  const repository = new PgProviderRepository(db);
  return {
    createProvider: repository.createProvider.bind(repository),
    getModel: repository.getModel.bind(repository),
    getProvider: repository.getProvider.bind(repository),
    listModels: repository.listModels.bind(repository),
    listProviders: repository.listProviders.bind(repository),
    updateModel: repository.updateModel.bind(repository),
    upsertModels: repository.upsertModels.bind(repository),
  };
}

export function createAgentEvalRepositoryFragment(
  db: RomeoDatabase,
): AgentEvalRepositoryFragment {
  const agents = new PgAgentRepository(db);
  const evals = new PgEvalRepository(db);
  return {
    createAgent: agents.createAgent.bind(agents),
    createAgentVersion: agents.createAgentVersion.bind(agents),
    createEvalCases: evals.createEvalCases.bind(evals),
    createEvalRun: evals.createEvalRun.bind(evals),
    createEvalRunResults: evals.createEvalRunResults.bind(evals),
    createEvalSuite: evals.createEvalSuite.bind(evals),
    getAgent: agents.getAgent.bind(agents),
    getAgentVersion: agents.getAgentVersion.bind(agents),
    getEvalRun: evals.getEvalRun.bind(evals),
    getEvalRunResult: evals.getEvalRunResult.bind(evals),
    getEvalResultHumanRating: evals.getEvalResultHumanRating.bind(evals),
    getEvalSuite: evals.getEvalSuite.bind(evals),
    listAgentKnowledgeBindings: agents.listAgentKnowledgeBindings.bind(agents),
    listAgentToolBindings: agents.listAgentToolBindings.bind(agents),
    listAgentVersions: agents.listAgentVersions.bind(agents),
    listAgents: agents.listAgents.bind(agents),
    listEvalCases: evals.listEvalCases.bind(evals),
    listEvalResultHumanRatings: evals.listEvalResultHumanRatings.bind(evals),
    listEvalRunResults: evals.listEvalRunResults.bind(evals),
    listEvalRuns: evals.listEvalRuns.bind(evals),
    listEvalSuites: evals.listEvalSuites.bind(evals),
    updateAgent: agents.updateAgent.bind(agents),
    upsertAgentKnowledgeBinding:
      agents.upsertAgentKnowledgeBinding.bind(agents),
    upsertAgentToolBinding: agents.upsertAgentToolBinding.bind(agents),
    upsertEvalResultHumanRating: evals.upsertEvalResultHumanRating.bind(evals),
  };
}

export function createChatRepositoryFragment(
  db: RomeoDatabase,
): ChatRepositoryFragment {
  const repository = new PgChatRepository(db);
  return {
    createChat: repository.createChat.bind(repository),
    createChatComment: repository.createChatComment.bind(repository),
    createMessage: repository.createMessage.bind(repository),
    createMessageParts: repository.createMessageParts.bind(repository),
    deleteMessage: repository.deleteMessage.bind(repository),
    getChat: repository.getChat.bind(repository),
    getMessage: repository.getMessage.bind(repository),
    getMessagePart: repository.getMessagePart.bind(repository),
    listChatComments: repository.listChatComments.bind(repository),
    listChats: repository.listChats.bind(repository),
    listMessageParts: repository.listMessageParts.bind(repository),
    listMessages: repository.listMessages.bind(repository),
    updateChat: repository.updateChat.bind(repository),
  };
}

export function createChatTagRepositoryFragment(
  db: RomeoDatabase,
): ChatTagRepositoryFragment {
  const repository = new PgChatTagRepository(db);
  return {
    countChatTagAssignments:
      repository.countChatTagAssignments.bind(repository),
    createChatTagAssignment:
      repository.createChatTagAssignment.bind(repository),
    deleteChatTag: repository.deleteChatTag.bind(repository),
    deleteChatTagAssignment:
      repository.deleteChatTagAssignment.bind(repository),
    listChatIdsByTag: repository.listChatIdsByTag.bind(repository),
    listChatTags: repository.listChatTags.bind(repository),
    listChatTagsForChat: repository.listChatTagsForChat.bind(repository),
    upsertChatTag: repository.upsertChatTag.bind(repository),
  };
}

export function createFileRepositoryFragment(
  db: RomeoDatabase,
): FileRepositoryFragment {
  const repository = new PgFileRepository(db);
  return {
    createFileObject: repository.createFileObject.bind(repository),
    getFileObject: repository.getFileObject.bind(repository),
    listFileObjects: repository.listFileObjects.bind(repository),
    updateFileObject: repository.updateFileObject.bind(repository),
  };
}

export function createCollaborationChannelRepositoryFragment(
  db: RomeoDatabase,
): CollaborationChannelRepositoryFragment {
  const repository = new PgCollaborationChannelRepository(db);
  return {
    createCollaborationChannel:
      repository.createCollaborationChannel.bind(repository),
    createCollaborationChannelMember:
      repository.createCollaborationChannelMember.bind(repository),
    deleteCollaborationChannel:
      repository.deleteCollaborationChannel.bind(repository),
    deleteCollaborationChannelMembers:
      repository.deleteCollaborationChannelMembers.bind(repository),
    getCollaborationChannel:
      repository.getCollaborationChannel.bind(repository),
    getCollaborationChannelMember:
      repository.getCollaborationChannelMember.bind(repository),
    listCollaborationChannelMembers:
      repository.listCollaborationChannelMembers.bind(repository),
    listCollaborationChannels:
      repository.listCollaborationChannels.bind(repository),
    updateCollaborationChannel:
      repository.updateCollaborationChannel.bind(repository),
    updateCollaborationChannelMember:
      repository.updateCollaborationChannelMember.bind(repository),
  };
}

export function createRunRepositoryFragment(
  db: RomeoDatabase,
): RunRepositoryFragment {
  const repository = new PgRunRepository(db);
  return {
    appendRunEvents: repository.appendRunEvents.bind(repository),
    createRun: repository.createRun.bind(repository),
    createToolCall: repository.createToolCall.bind(repository),
    getRun: repository.getRun.bind(repository),
    listRunEvents: repository.listRunEvents.bind(repository),
    listToolCalls: repository.listToolCalls.bind(repository),
    updateRun: repository.updateRun.bind(repository),
  };
}

export function createToolConnectorRepositoryFragment(
  db: RomeoDatabase,
): ToolConnectorRepositoryFragment {
  const repository = new PgToolConnectorRepository(db);
  return {
    createToolConnector: repository.createToolConnector.bind(repository),
    createToolOperations: repository.createToolOperations.bind(repository),
    listToolConnectors: repository.listToolConnectors.bind(repository),
    listToolOperations: repository.listToolOperations.bind(repository),
    updateToolConnector: repository.updateToolConnector.bind(repository),
    updateToolOperation: repository.updateToolOperation.bind(repository),
  };
}

export function createDataConnectorRepositoryFragment(
  db: RomeoDatabase,
): DataConnectorRepositoryFragment {
  const repository = new PgDataConnectorRepository(db);
  return {
    createDataConnector: repository.createDataConnector.bind(repository),
    createDataConnectorSync:
      repository.createDataConnectorSync.bind(repository),
    getDataConnector: repository.getDataConnector.bind(repository),
    listDataConnectors: repository.listDataConnectors.bind(repository),
    listDataConnectorSyncs: repository.listDataConnectorSyncs.bind(repository),
    updateDataConnector: repository.updateDataConnector.bind(repository),
    updateDataConnectorSync:
      repository.updateDataConnectorSync.bind(repository),
  };
}

export function createDelegatedOAuthRepositoryFragment(
  db: RomeoDatabase,
): DelegatedOAuthRepositoryFragment {
  const repository = new PgDelegatedOAuthRepository(db);
  return {
    createDelegatedOAuthConnection:
      repository.createDelegatedOAuthConnection.bind(repository),
    getDelegatedOAuthConnection:
      repository.getDelegatedOAuthConnection.bind(repository),
    getDelegatedOAuthConnectionByProviderAccount:
      repository.getDelegatedOAuthConnectionByProviderAccount.bind(repository),
    listDelegatedOAuthConnections:
      repository.listDelegatedOAuthConnections.bind(repository),
    updateDelegatedOAuthConnection:
      repository.updateDelegatedOAuthConnection.bind(repository),
  };
}

export function createOperationalRepositoryFragment(
  db: RomeoDatabase,
): OperationalRepositoryFragment {
  const repository = new PgOperationalRepository(db);
  return {
    claimBackgroundJob: repository.claimBackgroundJob.bind(repository),
    createAuditLog: repository.createAuditLog.bind(repository),
    createBackgroundJob: repository.createBackgroundJob.bind(repository),
    createUsageEvent: repository.createUsageEvent.bind(repository),
    deleteAuditLogsBefore: repository.deleteAuditLogsBefore.bind(repository),
    getSystemSetting: repository.getSystemSetting.bind(repository),
    listAuditLogs: repository.listAuditLogs.bind(repository),
    listBackgroundJobs: repository.listBackgroundJobs.bind(repository),
    listSystemSettings: repository.listSystemSettings.bind(repository),
    listUsageEvents: repository.listUsageEvents.bind(repository),
    renewBackgroundJobLease:
      repository.renewBackgroundJobLease.bind(repository),
    upsertSystemSetting: repository.upsertSystemSetting.bind(repository),
    updateBackgroundJob: repository.updateBackgroundJob.bind(repository),
    updateUsageEvent: repository.updateUsageEvent.bind(repository),
  };
}

export function createWebhookRepositoryFragment(
  db: RomeoDatabase,
): WebhookRepositoryFragment {
  const repository = new PgWebhookRepository(db);
  return {
    createWebhookDelivery: repository.createWebhookDelivery.bind(repository),
    createWebhookSubscription:
      repository.createWebhookSubscription.bind(repository),
    getWebhookSubscription: repository.getWebhookSubscription.bind(repository),
    listWebhookDeliveries: repository.listWebhookDeliveries.bind(repository),
    listWebhookSubscriptions:
      repository.listWebhookSubscriptions.bind(repository),
    updateWebhookDelivery: repository.updateWebhookDelivery.bind(repository),
    updateWebhookSubscription:
      repository.updateWebhookSubscription.bind(repository),
  };
}

export function createWorkflowRepositoryFragment(
  db: RomeoDatabase,
): WorkflowRepositoryFragment {
  const repository = new PgWorkflowRepository(db);
  return {
    createWorkflowDefinition:
      repository.createWorkflowDefinition.bind(repository),
    createWorkflowRun: repository.createWorkflowRun.bind(repository),
    getWorkflowDefinition: repository.getWorkflowDefinition.bind(repository),
    getWorkflowRun: repository.getWorkflowRun.bind(repository),
    listWorkflowDefinitions:
      repository.listWorkflowDefinitions.bind(repository),
    listWorkflowRuns: repository.listWorkflowRuns.bind(repository),
    updateWorkflowDefinition:
      repository.updateWorkflowDefinition.bind(repository),
    updateWorkflowRun: repository.updateWorkflowRun.bind(repository),
  };
}

export function createGovernanceBillingRepositoryFragment(
  db: RomeoDatabase,
): GovernanceBillingRepositoryFragment {
  const repository = new PgGovernanceBillingRepository(db);
  return {
    createQuotaBucket: repository.createQuotaBucket.bind(repository),
    deleteQuotaBucket: repository.deleteQuotaBucket.bind(repository),
    getBillingPlan: repository.getBillingPlan.bind(repository),
    getRetentionPolicy: repository.getRetentionPolicy.bind(repository),
    listQuotaBuckets: repository.listQuotaBuckets.bind(repository),
    updateQuotaBucket: repository.updateQuotaBucket.bind(repository),
    upsertBillingPlan: repository.upsertBillingPlan.bind(repository),
    upsertRetentionPolicy: repository.upsertRetentionPolicy.bind(repository),
  };
}

export function createNotificationRepositoryFragment(
  db: RomeoDatabase,
): NotificationRepositoryFragment {
  const repository = new PgNotificationRepository(db);
  return {
    createNotificationDelivery:
      repository.createNotificationDelivery.bind(repository),
    createNotificationDeliveryChannel:
      repository.createNotificationDeliveryChannel.bind(repository),
    createUserNotification: repository.createUserNotification.bind(repository),
    listNotificationDeliveries:
      repository.listNotificationDeliveries.bind(repository),
    listNotificationDeliveryChannels:
      repository.listNotificationDeliveryChannels.bind(repository),
    listUserNotifications: repository.listUserNotifications.bind(repository),
    updateNotificationDelivery:
      repository.updateNotificationDelivery.bind(repository),
    updateUserNotification: repository.updateUserNotification.bind(repository),
  };
}

export function createCollaborationRepositoryFragment(
  db: RomeoDatabase,
): CollaborationRepositoryFragment {
  const repository = new PgCollaborationRepository(db);
  return {
    createPromptTemplate: repository.createPromptTemplate.bind(repository),
    createResourceFavorite: repository.createResourceFavorite.bind(repository),
    createWorkspaceFolder: repository.createWorkspaceFolder.bind(repository),
    createWorkspaceFolderItem:
      repository.createWorkspaceFolderItem.bind(repository),
    deletePromptTemplate: repository.deletePromptTemplate.bind(repository),
    deleteResourceFavorite: repository.deleteResourceFavorite.bind(repository),
    deleteWorkspaceFolder: repository.deleteWorkspaceFolder.bind(repository),
    deleteWorkspaceFolderItem:
      repository.deleteWorkspaceFolderItem.bind(repository),
    getPromptTemplate: repository.getPromptTemplate.bind(repository),
    getWorkspaceFolder: repository.getWorkspaceFolder.bind(repository),
    listPromptTemplates: repository.listPromptTemplates.bind(repository),
    listResourceFavorites: repository.listResourceFavorites.bind(repository),
    listWorkspaceFolderItems:
      repository.listWorkspaceFolderItems.bind(repository),
    listWorkspaceFolders: repository.listWorkspaceFolders.bind(repository),
    updatePromptTemplate: repository.updatePromptTemplate.bind(repository),
    updateWorkspaceFolder: repository.updateWorkspaceFolder.bind(repository),
  };
}

export function createAccessRepositoryFragment(
  db: RomeoDatabase,
): AccessRepositoryFragment {
  const repository = new PgAccessRepository(db);
  return {
    createResourceGrant: repository.createResourceGrant.bind(repository),
    deleteResourceGrantsForPrincipal:
      repository.deleteResourceGrantsForPrincipal.bind(repository),
    listResourceGrants: repository.listResourceGrants.bind(repository),
  };
}

export function createVoiceRepositoryFragment(
  db: RomeoDatabase,
): VoiceRepositoryFragment {
  const repository = new PgVoiceRepository(db);
  return {
    createVoiceProfile: repository.createVoiceProfile.bind(repository),
    getVoiceProfile: repository.getVoiceProfile.bind(repository),
    listVoiceProfiles: repository.listVoiceProfiles.bind(repository),
  };
}

export function createDataDeletionRepositoryFragment(
  db: RomeoDatabase,
): DataDeletionRepositoryFragment {
  const repository = new PgDataDeletionRepository(db);
  return {
    deleteDataForResource: repository.deleteDataForResource.bind(repository),
    getDataDeletionPlan: repository.getDataDeletionPlan.bind(repository),
  };
}

export function composeRepositoryFragments<
  const Fragments extends readonly RepositoryFragment[],
>(...fragments: Fragments): UnionToIntersection<Fragments[number]> {
  const composed: Record<string, (...args: never[]) => Promise<unknown>> = {};
  for (const fragment of fragments) {
    for (const [name, method] of Object.entries(fragment)) {
      if (composed[name] !== undefined)
        throw new Error(`Repository fragment collision: ${name}`);
      composed[name] = method;
    }
  }
  return composed as UnionToIntersection<Fragments[number]>;
}
