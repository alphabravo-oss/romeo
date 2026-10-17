import type { PrincipalType } from "@romeo/auth";

import type {
  Agent,
  AgentKnowledgeBinding,
  AgentToolBinding,
  AgentVersion,
  ApiKey,
  BaseModel,
  DeviceAuthorization,
  EvalCase,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  Group,
  GroupMembership,
  LocalMfaFactor,
  LocalMfaChallenge,
  LocalPasswordCredential,
  SamlAuthRequest,
  ManagedModelCustomizationPolicyRecord,
  ManagedModelPreferenceRecord,
  MembershipSourceOptions,
  Organization,
  ProviderInstance,
  ServiceAccount,
  SsoOidcSettings,
  SystemSetting,
  User,
  UserSession,
  Workspace,
} from "./entities";
import type {
  ModelCatalogQuery,
  QueryUsersInput,
  TenantDataPurgeResult,
  UserCatalogPage,
  UserCatalogQuery,
  UserTableQueryResult,
} from "./repository";

export interface RepositoryIdentityCapability {
  getCurrentUser(userId: string): Promise<User | undefined>;
  listUsers(orgId: string): Promise<User[]>;
  listUsersPage(
    orgId: string,
    query: UserCatalogQuery,
  ): Promise<UserCatalogPage>;
  queryUsers(
    orgId: string,
    query: QueryUsersInput,
  ): Promise<UserTableQueryResult>;
  createUser(user: User): Promise<User>;
  updateUser(user: User): Promise<User>;
  listGroups(orgId: string): Promise<Group[]>;
  getGroup(groupId: string): Promise<Group | undefined>;
  createGroup(group: Group): Promise<Group>;
  updateGroup(group: Group): Promise<Group>;
  deleteGroup(groupId: string): Promise<Group | undefined>;
  listGroupMemberships(
    orgId: string,
    groupId?: string,
    userId?: string,
  ): Promise<GroupMembership[]>;
  listGroupMembershipsBySource(
    orgId: string,
    userId: string,
    source: string,
  ): Promise<GroupMembership[]>;
  createGroupMembership(
    membership: GroupMembership,
    options?: MembershipSourceOptions,
  ): Promise<GroupMembership>;
  deleteGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMembership | undefined>;
  getSsoOidcSettings(orgId: string): Promise<SsoOidcSettings | undefined>;
  /** Enabled OIDC settings for one issuer (with or without trailing slash). */
  listEnabledSsoOidcSettingsByIssuer(
    issuerUrl: string,
  ): Promise<SsoOidcSettings[]>;
  upsertSsoOidcSettings(settings: SsoOidcSettings): Promise<SsoOidcSettings>;
  getSystemSetting(
    key: string,
    orgId: string | null,
  ): Promise<SystemSetting | undefined>;
  listSystemSettings(orgId: string | null): Promise<SystemSetting[]>;
  upsertSystemSetting(
    setting: SystemSetting,
    orgId: string | null,
  ): Promise<SystemSetting>;
  listAllOrganizations(): Promise<Organization[]>;
  listOrganizations(orgId: string): Promise<Organization[]>;
  getOrganization(orgId: string): Promise<Organization | undefined>;
  createOrganization(organization: Organization): Promise<Organization>;
  updateOrganization(organization: Organization): Promise<Organization>;
  listWorkspaces(orgId: string): Promise<Workspace[]>;
  getWorkspace(workspaceId: string): Promise<Workspace | undefined>;
  createWorkspace(workspace: Workspace): Promise<Workspace>;
  updateWorkspace(workspace: Workspace): Promise<Workspace>;
  purgeTenantData(orgId: string): Promise<TenantDataPurgeResult>;
  listApiKeys(orgId: string): Promise<ApiKey[]>;
  getApiKey(apiKeyId: string): Promise<ApiKey | undefined>;
  getApiKeyByHash(hashedToken: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: ApiKey): Promise<ApiKey>;
  updateApiKey(apiKey: ApiKey): Promise<ApiKey>;
  listDeviceAuthorizations(
    orgId: string,
    userId: string,
  ): Promise<DeviceAuthorization[]>;
  getDeviceAuthorization(
    deviceAuthorizationId: string,
  ): Promise<DeviceAuthorization | undefined>;
  getDeviceAuthorizationByRefreshHash(
    hashedRefreshToken: string,
  ): Promise<DeviceAuthorization | undefined>;
  createDeviceAuthorization(
    authorization: DeviceAuthorization,
  ): Promise<DeviceAuthorization>;
  updateDeviceAuthorization(
    authorization: DeviceAuthorization,
  ): Promise<DeviceAuthorization>;
  rotateDeviceAuthorization(input: {
    authorization: DeviceAuthorization;
    expectedRefreshHash: string;
  }): Promise<DeviceAuthorization | undefined>;
  listUserSessions(orgId: string, userId: string): Promise<UserSession[]>;
  getUserSession(sessionId: string): Promise<UserSession | undefined>;
  getUserSessionByHash(hashedToken: string): Promise<UserSession | undefined>;
  createUserSession(session: UserSession): Promise<UserSession>;
  updateUserSession(session: UserSession): Promise<UserSession>;
  getLocalPasswordCredentialByUserId(
    userId: string,
  ): Promise<LocalPasswordCredential | undefined>;
  getLocalPasswordCredentialByEmail(
    orgId: string,
    emailNormalized: string,
  ): Promise<LocalPasswordCredential | undefined>;
  createLocalPasswordCredential(
    credential: LocalPasswordCredential,
  ): Promise<LocalPasswordCredential>;
  updateLocalPasswordCredential(
    credential: LocalPasswordCredential,
  ): Promise<LocalPasswordCredential>;
  recordFailedLocalPasswordAttempt(input: {
    credentialId: string;
    attemptedAt: string;
    lockedUntil: string;
    maxFailedAttempts: number;
  }): Promise<LocalPasswordCredential | undefined>;
  /** Counts a failed MFA verification and locks the credential at the limit. */
  recordFailedLocalMfaAttempt(input: {
    credentialId: string;
    attemptedAt: string;
    lockedUntil: string;
    maxFailedAttempts: number;
  }): Promise<LocalPasswordCredential | undefined>;
  resetFailedLocalMfaAttempts(input: {
    credentialId: string;
    updatedAt: string;
  }): Promise<void>;
  /** Records a TOTP step only when it is newer than the last accepted step. */
  acceptLocalMfaTotpStep(input: {
    factorId: string;
    timeStep: number;
    usedAt: string;
  }): Promise<LocalMfaFactor | undefined>;
  listLocalMfaFactors(orgId: string, userId: string): Promise<LocalMfaFactor[]>;
  listLocalMfaFactorsForOrg(orgId: string): Promise<LocalMfaFactor[]>;
  getLocalMfaFactor(factorId: string): Promise<LocalMfaFactor | undefined>;
  createLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor>;
  updateLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor>;
  consumeLocalMfaFactor(input: {
    factor: LocalMfaFactor;
    expectedSecretEncrypted: string;
  }): Promise<LocalMfaFactor | undefined>;
  createLocalMfaChallenge(
    challenge: LocalMfaChallenge,
  ): Promise<LocalMfaChallenge>;
  consumeLocalMfaChallenge(input: {
    id: string;
    orgId: string;
    userId: string;
    consumedAt: string;
  }): Promise<LocalMfaChallenge | undefined>;
  /** Reserves one verification attempt on a live, unexhausted challenge. */
  claimLocalMfaChallengeAttempt(input: {
    id: string;
    orgId: string;
    userId: string;
    attemptedAt: string;
    maxAttempts: number;
  }): Promise<LocalMfaChallenge | undefined>;
  createSamlAuthRequest(request: SamlAuthRequest): Promise<SamlAuthRequest>;
  consumeSamlAuthRequest(input: {
    id: string;
    orgId: string;
    providerId: "saml";
    relayStateHash: string;
    consumedAt: string;
  }): Promise<SamlAuthRequest | undefined>;
  listServiceAccounts(orgId: string): Promise<ServiceAccount[]>;
  getServiceAccount(
    serviceAccountId: string,
  ): Promise<ServiceAccount | undefined>;
  createServiceAccount(serviceAccount: ServiceAccount): Promise<ServiceAccount>;
  updateServiceAccount(serviceAccount: ServiceAccount): Promise<ServiceAccount>;
  listProviders(orgId: string): Promise<ProviderInstance[]>;
  getProvider(providerId: string): Promise<ProviderInstance | undefined>;
  createProvider(provider: ProviderInstance): Promise<ProviderInstance>;
  updateProvider(provider: ProviderInstance): Promise<ProviderInstance>;
  listModels(orgId: string): Promise<BaseModel[]>;
  listModelsPage(
    orgId: string,
    input: ModelCatalogQuery,
  ): Promise<{ items: BaseModel[]; total: number }>;
  getModel(modelId: string): Promise<BaseModel | undefined>;
  updateModel(model: BaseModel): Promise<BaseModel>;
  upsertModels(models: BaseModel[]): Promise<BaseModel[]>;
  listAgents(workspaceId: string): Promise<Agent[]>;
  createAgent(agent: Agent): Promise<Agent>;
  archiveAgent(agentId: string, archivedAt: string): Promise<Agent | undefined>;
  updateAgent(agent: Agent): Promise<Agent>;
  getAgent(agentId: string): Promise<Agent | undefined>;
  listAgentKnowledgeBindings(agentId: string): Promise<AgentKnowledgeBinding[]>;
  upsertAgentKnowledgeBinding(
    binding: AgentKnowledgeBinding,
  ): Promise<AgentKnowledgeBinding>;
  listAgentToolBindings(agentId: string): Promise<AgentToolBinding[]>;
  upsertAgentToolBinding(binding: AgentToolBinding): Promise<AgentToolBinding>;
  listAgentVersions(agentId: string): Promise<AgentVersion[]>;
  getAgentVersion(versionId: string): Promise<AgentVersion | undefined>;
  createAgentVersion(version: AgentVersion): Promise<AgentVersion>;
  getManagedModelCustomizationPolicy(
    orgId: string,
    agentId: string,
  ): Promise<ManagedModelCustomizationPolicyRecord | undefined>;
  upsertManagedModelCustomizationPolicy(
    policy: ManagedModelCustomizationPolicyRecord,
  ): Promise<ManagedModelCustomizationPolicyRecord>;
  getManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<ManagedModelPreferenceRecord | undefined>;
  listManagedModelPreferences(
    orgId: string,
    agentId: string,
  ): Promise<ManagedModelPreferenceRecord[]>;
  upsertManagedModelPreference(
    preference: ManagedModelPreferenceRecord,
  ): Promise<ManagedModelPreferenceRecord>;
  deleteManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<void>;
  listEvalSuites(agentId: string): Promise<EvalSuite[]>;
  listEvalSuitesForAgents(agentIds: string[]): Promise<EvalSuite[]>;
  getEvalSuite(suiteId: string): Promise<EvalSuite | undefined>;
  createEvalSuite(suite: EvalSuite): Promise<EvalSuite>;
  listEvalCases(suiteId: string): Promise<EvalCase[]>;
  createEvalCases(cases: EvalCase[]): Promise<EvalCase[]>;
  listEvalRuns(agentId: string): Promise<EvalRun[]>;
  listEvalRunsForAgents(agentIds: string[]): Promise<EvalRun[]>;
  getEvalRun(runId: string): Promise<EvalRun | undefined>;
  createEvalRun(run: EvalRun): Promise<EvalRun>;
  getEvalRunResult(resultId: string): Promise<EvalRunResult | undefined>;
  listEvalRunResults(runId: string): Promise<EvalRunResult[]>;
  createEvalRunResults(results: EvalRunResult[]): Promise<EvalRunResult[]>;
  listEvalResultHumanRatings(runId: string): Promise<EvalResultHumanRating[]>;
  getEvalResultHumanRating(
    resultId: string,
    reviewerId: string,
  ): Promise<EvalResultHumanRating | undefined>;
  upsertEvalResultHumanRating(
    rating: EvalResultHumanRating,
  ): Promise<EvalResultHumanRating>;
}
