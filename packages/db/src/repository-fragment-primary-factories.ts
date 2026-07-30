import type { RomeoDatabase } from "./client";
import { PgAgentRepository } from "./agent-repository";
import { PgAuthCredentialRepository } from "./auth-credential-repository";
import { PgChatRepository } from "./chat-repository";
import { PgChatTagRepository } from "./chat-tag-repository";
import { PgEvalRepository } from "./eval-repository";
import { PgIdentityRepository } from "./identity-repository";
import { PgKnowledgeEmbeddingRepository } from "./knowledge-embedding-repository";
import { PgKnowledgeRepository } from "./knowledge-repository";
import { PgProviderRepository } from "./provider-repository";
import { PgTenantRepository } from "./tenant-repository";
import { PgTenantPurgeRepository } from "./tenant-purge-repository";
import type {
  AgentEvalRepositoryFragment,
  AuthCredentialRepositoryFragment,
  ChatRepositoryFragment,
  ChatTagRepositoryFragment,
  KnowledgeEmbeddingRepositoryFragment,
  KnowledgeRepositoryFragment,
  ProviderRepositoryFragment,
  TenantIdentityRepositoryFragment,
} from "./repository-fragment-types";

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
    listUsersPage: identity.listUsersPage.bind(identity),
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
    updateProvider: repository.updateProvider.bind(repository),
    getModel: repository.getModel.bind(repository),
    getProvider: repository.getProvider.bind(repository),
    listModels: repository.listModels.bind(repository),
    listModelsPage: repository.listModelsPage.bind(repository),
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
    archiveAgent: agents.archiveAgent.bind(agents),
    createAgent: agents.createAgent.bind(agents),
    createAgentVersion: agents.createAgentVersion.bind(agents),
    createEvalCases: evals.createEvalCases.bind(evals),
    createEvalRun: evals.createEvalRun.bind(evals),
    createEvalRunResults: evals.createEvalRunResults.bind(evals),
    createEvalSuite: evals.createEvalSuite.bind(evals),
    getAgent: agents.getAgent.bind(agents),
    getAgentVersion: agents.getAgentVersion.bind(agents),
    getManagedModelCustomizationPolicy:
      agents.getManagedModelCustomizationPolicy.bind(agents),
    getManagedModelPreference: agents.getManagedModelPreference.bind(agents),
    getEvalRun: evals.getEvalRun.bind(evals),
    getEvalRunResult: evals.getEvalRunResult.bind(evals),
    getEvalResultHumanRating: evals.getEvalResultHumanRating.bind(evals),
    getEvalSuite: evals.getEvalSuite.bind(evals),
    listAgentKnowledgeBindings: agents.listAgentKnowledgeBindings.bind(agents),
    listAgentToolBindings: agents.listAgentToolBindings.bind(agents),
    listAgentVersions: agents.listAgentVersions.bind(agents),
    listAgents: agents.listAgents.bind(agents),
    listManagedModelPreferences:
      agents.listManagedModelPreferences.bind(agents),
    listEvalCases: evals.listEvalCases.bind(evals),
    listEvalResultHumanRatings: evals.listEvalResultHumanRatings.bind(evals),
    listEvalRunResults: evals.listEvalRunResults.bind(evals),
    listEvalRuns: evals.listEvalRuns.bind(evals),
    listEvalRunsForAgents: evals.listEvalRunsForAgents.bind(evals),
    listEvalSuites: evals.listEvalSuites.bind(evals),
    listEvalSuitesForAgents: evals.listEvalSuitesForAgents.bind(evals),
    updateAgent: agents.updateAgent.bind(agents),
    deleteManagedModelPreference:
      agents.deleteManagedModelPreference.bind(agents),
    upsertManagedModelCustomizationPolicy:
      agents.upsertManagedModelCustomizationPolicy.bind(agents),
    upsertManagedModelPreference:
      agents.upsertManagedModelPreference.bind(agents),
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
    createQueuedChatTurn: repository.createQueuedChatTurn.bind(repository),
    createMessage: repository.createMessage.bind(repository),
    createMessageParts: repository.createMessageParts.bind(repository),
    deleteMessage: repository.deleteMessage.bind(repository),
    getChat: repository.getChat.bind(repository),
    getMessage: repository.getMessage.bind(repository),
    getMessagePart: repository.getMessagePart.bind(repository),
    getQueuedChatTurn: repository.getQueuedChatTurn.bind(repository),
    getQueuedChatTurnByIdempotency:
      repository.getQueuedChatTurnByIdempotency.bind(repository),
    listChatComments: repository.listChatComments.bind(repository),
    listChats: repository.listChats.bind(repository),
    listAuthorizedChatsPage:
      repository.listAuthorizedChatsPage.bind(repository),
    listMessageParts: repository.listMessageParts.bind(repository),
    listMessages: repository.listMessages.bind(repository),
    listQueuedChatTurns: repository.listQueuedChatTurns.bind(repository),
    claimNextQueuedChatTurn:
      repository.claimNextQueuedChatTurn.bind(repository),
    cancelQueuedChatTurn: repository.cancelQueuedChatTurn.bind(repository),
    finishQueuedChatTurnLease:
      repository.finishQueuedChatTurnLease.bind(repository),
    renewQueuedChatTurnLease:
      repository.renewQueuedChatTurnLease.bind(repository),
    searchChatContent: repository.searchChatContent.bind(repository),
    updateChat: repository.updateChat.bind(repository),
    updateMessagePart: repository.updateMessagePart.bind(repository),
    updateQueuedChatTurn: repository.updateQueuedChatTurn.bind(repository),
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
