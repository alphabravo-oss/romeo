import type { PrincipalType, ResourceGrant } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type {
  DelegatedOAuthConnection,
  DelegatedOAuthProviderId,
} from "./delegated-oauth";
import type { DataConnectorType } from "./data-connectors";
import type {
  Agent,
  AgentKnowledgeBinding,
  AgentToolBinding,
  AgentVersion,
  ApiKey,
  AuditLog,
  BackgroundJob,
  BillingPlan,
  BaseModel,
  Chat,
  ChatComment,
  ChatTag,
  ChatTagAssignment,
  DataDeletionPlan,
  DataDeletionResourceType,
  DataConnector,
  DataConnectorSync,
  DeviceAuthorization,
  EvalCase,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  FileObject,
  Group,
  GroupMembership,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
  KnowledgeSource,
  LocalMfaFactor,
  LocalPasswordCredential,
  Message,
  MessagePart,
  NotificationDelivery,
  NotificationDeliveryChannel,
  CollaborationChannel,
  CollaborationChannelMember,
  Organization,
  PromptTemplate,
  ProviderInstance,
  QuotaBucket,
  RetentionPolicy,
  ResourceFavorite,
  RunRecord,
  ServiceAccount,
  SsoOidcSettings,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  UsageEvent,
  UserSession,
  UserNotification,
  User,
  VoiceProfile,
  WebhookDelivery,
  WebhookSubscription,
  WorkspaceFolder,
  WorkspaceFolderItem,
  WorkflowDefinition,
  WorkflowRun,
  Workspace,
  SystemSetting,
} from "./entities";

export interface RomeoRepository {
  readonly runtime?: RomeoRepositoryRuntime;

  transaction<T>(work: (repository: RomeoRepository) => Promise<T>): Promise<T>;
  getCurrentUser(userId: string): Promise<User | undefined>;
  listUsers(orgId: string): Promise<User[]>;
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
  createGroupMembership(membership: GroupMembership): Promise<GroupMembership>;
  deleteGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMembership | undefined>;
  getSsoOidcSettings(orgId: string): Promise<SsoOidcSettings | undefined>;
  upsertSsoOidcSettings(settings: SsoOidcSettings): Promise<SsoOidcSettings>;
  getSystemSetting(key: string): Promise<SystemSetting | undefined>;
  listSystemSettings(): Promise<SystemSetting[]>;
  upsertSystemSetting(setting: SystemSetting): Promise<SystemSetting>;
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
  listLocalMfaFactors(orgId: string, userId: string): Promise<LocalMfaFactor[]>;
  listLocalMfaFactorsForOrg(orgId: string): Promise<LocalMfaFactor[]>;
  getLocalMfaFactor(factorId: string): Promise<LocalMfaFactor | undefined>;
  createLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor>;
  updateLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor>;
  listServiceAccounts(orgId: string): Promise<ServiceAccount[]>;
  getServiceAccount(
    serviceAccountId: string,
  ): Promise<ServiceAccount | undefined>;
  createServiceAccount(serviceAccount: ServiceAccount): Promise<ServiceAccount>;
  updateServiceAccount(serviceAccount: ServiceAccount): Promise<ServiceAccount>;
  listProviders(orgId: string): Promise<ProviderInstance[]>;
  getProvider(providerId: string): Promise<ProviderInstance | undefined>;
  createProvider(provider: ProviderInstance): Promise<ProviderInstance>;
  listModels(orgId: string): Promise<BaseModel[]>;
  getModel(modelId: string): Promise<BaseModel | undefined>;
  updateModel(model: BaseModel): Promise<BaseModel>;
  upsertModels(models: BaseModel[]): Promise<BaseModel[]>;
  listAgents(workspaceId: string): Promise<Agent[]>;
  createAgent(agent: Agent): Promise<Agent>;
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
  listEvalSuites(agentId: string): Promise<EvalSuite[]>;
  getEvalSuite(suiteId: string): Promise<EvalSuite | undefined>;
  createEvalSuite(suite: EvalSuite): Promise<EvalSuite>;
  listEvalCases(suiteId: string): Promise<EvalCase[]>;
  createEvalCases(cases: EvalCase[]): Promise<EvalCase[]>;
  listEvalRuns(agentId: string): Promise<EvalRun[]>;
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
  listChats(workspaceId: string): Promise<Chat[]>;
  createChat(chat: Chat): Promise<Chat>;
  updateChat(chat: Chat): Promise<Chat>;
  getChat(chatId: string): Promise<Chat | undefined>;
  listMessages(chatId: string): Promise<Message[]>;
  getMessage(messageId: string): Promise<Message | undefined>;
  createMessage(message: Message): Promise<Message>;
  deleteMessage(messageId: string): Promise<void>;
  listMessageParts(messageId: string): Promise<MessagePart[]>;
  getMessagePart(messagePartId: string): Promise<MessagePart | undefined>;
  createMessageParts(parts: MessagePart[]): Promise<MessagePart[]>;
  listChatComments(chatId: string): Promise<ChatComment[]>;
  createChatComment(comment: ChatComment): Promise<ChatComment>;
  listFileObjects(orgId: string, workspaceId?: string): Promise<FileObject[]>;
  getFileObject(fileId: string): Promise<FileObject | undefined>;
  createFileObject(file: FileObject): Promise<FileObject>;
  updateFileObject(file: FileObject): Promise<FileObject>;
  listChatTags(orgId: string, userId: string): Promise<ChatTag[]>;
  listChatTagsForChat(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<ChatTag[]>;
  listChatIdsByTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<string[]>;
  upsertChatTag(tag: ChatTag): Promise<ChatTag>;
  createChatTagAssignment(
    assignment: ChatTagAssignment,
  ): Promise<ChatTagAssignment>;
  deleteChatTagAssignment(
    orgId: string,
    userId: string,
    chatId: string,
    slug: string,
  ): Promise<ChatTagAssignment | undefined>;
  countChatTagAssignments(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<number>;
  deleteChatTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<ChatTag | undefined>;
  listCollaborationChannels(orgId: string): Promise<CollaborationChannel[]>;
  getCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined>;
  createCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel>;
  updateCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel>;
  deleteCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined>;
  listCollaborationChannelMembers(
    orgId: string,
    channelId?: string,
    userId?: string,
  ): Promise<CollaborationChannelMember[]>;
  getCollaborationChannelMember(
    channelId: string,
    userId: string,
  ): Promise<CollaborationChannelMember | undefined>;
  createCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember>;
  updateCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember>;
  deleteCollaborationChannelMembers(
    channelId: string,
    userIds: string[],
  ): Promise<CollaborationChannelMember[]>;
  listUserNotifications(
    orgId: string,
    userId: string,
  ): Promise<UserNotification[]>;
  createUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification>;
  updateUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification>;
  listNotificationDeliveryChannels(
    orgId: string,
    userId: string,
  ): Promise<NotificationDeliveryChannel[]>;
  createNotificationDeliveryChannel(
    channel: NotificationDeliveryChannel,
  ): Promise<NotificationDeliveryChannel>;
  listNotificationDeliveries(
    orgId: string,
    userId: string,
  ): Promise<NotificationDelivery[]>;
  createNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery>;
  updateNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery>;
  listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]>;
  createKnowledgeBase(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase>;
  updateKnowledgeBase(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase>;
  getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase | undefined>;
  listKnowledgeSources(knowledgeBaseId: string): Promise<KnowledgeSource[]>;
  createKnowledgeSource(source: KnowledgeSource): Promise<KnowledgeSource>;
  updateKnowledgeSource(source: KnowledgeSource): Promise<KnowledgeSource>;
  deleteKnowledgeSource(sourceId: string): Promise<KnowledgeSource | undefined>;
  listKnowledgeChunks(knowledgeBaseId: string): Promise<KnowledgeChunk[]>;
  createKnowledgeChunks(chunks: KnowledgeChunk[]): Promise<KnowledgeChunk[]>;
  deleteKnowledgeChunksForSource(sourceId: string): Promise<void>;
  listKnowledgeChunkEmbeddings(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunkEmbedding[]>;
  searchKnowledgeChunkEmbeddings(input: {
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    embeddingProvider: string;
    embeddingModel: string;
    dimensions: number;
    queryEmbedding: number[];
    maxResults: number;
  }): Promise<KnowledgeChunkEmbeddingSearchHit[]>;
  upsertKnowledgeChunkEmbeddings(
    embeddings: KnowledgeChunkEmbedding[],
  ): Promise<KnowledgeChunkEmbedding[]>;
  deleteKnowledgeChunkEmbeddingsForSource(sourceId: string): Promise<void>;
  listDataConnectors(
    orgId: string,
    workspaceId?: string,
  ): Promise<DataConnector[]>;
  getDataConnector(connectorId: string): Promise<DataConnector | undefined>;
  createDataConnector(connector: DataConnector): Promise<DataConnector>;
  updateDataConnector(connector: DataConnector): Promise<DataConnector>;
  listDataConnectorSyncs(
    orgId: string,
    connectorId?: string,
  ): Promise<DataConnectorSync[]>;
  createDataConnectorSync(sync: DataConnectorSync): Promise<DataConnectorSync>;
  updateDataConnectorSync(sync: DataConnectorSync): Promise<DataConnectorSync>;
  listDelegatedOAuthConnections(
    orgId: string,
    workspaceId?: string,
    userId?: string,
  ): Promise<DelegatedOAuthConnection[]>;
  getDelegatedOAuthConnection(
    connectionId: string,
  ): Promise<DelegatedOAuthConnection | undefined>;
  getDelegatedOAuthConnectionByProviderAccount(input: {
    connectorType: DataConnectorType;
    orgId: string;
    providerAccountId: string;
    providerId: DelegatedOAuthProviderId;
    userId: string;
    workspaceId: string;
  }): Promise<DelegatedOAuthConnection | undefined>;
  createDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection>;
  updateDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection>;
  withDelegatedOAuthConnectionRefreshLock<T>(
    connectionId: string,
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T>;
  listVoiceProfiles(orgId: string): Promise<VoiceProfile[]>;
  getVoiceProfile(voiceProfileId: string): Promise<VoiceProfile | undefined>;
  createVoiceProfile(voiceProfile: VoiceProfile): Promise<VoiceProfile>;
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  updateRun(run: RunRecord): Promise<RunRecord>;
  appendRunEvents(events: RunEvent[]): Promise<void>;
  listRunEvents(runId: string): Promise<RunEvent[]>;
  listToolCalls(orgId: string): Promise<ToolCallRecord[]>;
  createToolCall(call: ToolCallRecord): Promise<ToolCallRecord>;
  listToolConnectors(orgId: string): Promise<ToolConnector[]>;
  createToolConnector(connector: ToolConnector): Promise<ToolConnector>;
  updateToolConnector(connector: ToolConnector): Promise<ToolConnector>;
  listToolOperations(connectorId: string): Promise<ToolOperation[]>;
  createToolOperations(operations: ToolOperation[]): Promise<ToolOperation[]>;
  updateToolOperation(operation: ToolOperation): Promise<ToolOperation>;
  listAuditLogs(orgId: string): Promise<AuditLog[]>;
  createAuditLog(log: AuditLog): Promise<AuditLog>;
  deleteAuditLogsBefore(orgId: string, before: string): Promise<number>;
  getDataDeletionPlan(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
  ): Promise<DataDeletionPlan | undefined>;
  deleteDataForResource(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
  ): Promise<DataDeletionPlan | undefined>;
  listUsageEvents(orgId: string): Promise<UsageEvent[]>;
  createUsageEvent(event: UsageEvent): Promise<UsageEvent>;
  updateUsageEvent(event: UsageEvent): Promise<UsageEvent>;
  listBackgroundJobs(orgId: string): Promise<BackgroundJob[]>;
  createBackgroundJob(job: BackgroundJob): Promise<BackgroundJob>;
  claimBackgroundJob(
    input: ClaimBackgroundJobInput,
  ): Promise<BackgroundJob | undefined>;
  renewBackgroundJobLease(
    input: RenewBackgroundJobLeaseInput,
  ): Promise<BackgroundJob | undefined>;
  updateBackgroundJob(job: BackgroundJob): Promise<BackgroundJob>;
  listWebhookSubscriptions(orgId: string): Promise<WebhookSubscription[]>;
  createWebhookSubscription(
    subscription: WebhookSubscription,
  ): Promise<WebhookSubscription>;
  updateWebhookSubscription(
    subscription: WebhookSubscription,
  ): Promise<WebhookSubscription>;
  getWebhookSubscription(
    subscriptionId: string,
  ): Promise<WebhookSubscription | undefined>;
  listWebhookDeliveries(
    orgId: string,
    subscriptionId?: string,
  ): Promise<WebhookDelivery[]>;
  createWebhookDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  updateWebhookDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  listWorkflowDefinitions(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkflowDefinition[]>;
  getWorkflowDefinition(
    workflowId: string,
  ): Promise<WorkflowDefinition | undefined>;
  createWorkflowDefinition(
    workflow: WorkflowDefinition,
  ): Promise<WorkflowDefinition>;
  updateWorkflowDefinition(
    workflow: WorkflowDefinition,
  ): Promise<WorkflowDefinition>;
  listWorkflowRuns(orgId: string, workflowId?: string): Promise<WorkflowRun[]>;
  getWorkflowRun(workflowRunId: string): Promise<WorkflowRun | undefined>;
  createWorkflowRun(run: WorkflowRun): Promise<WorkflowRun>;
  updateWorkflowRun(run: WorkflowRun): Promise<WorkflowRun>;
  getRetentionPolicy(orgId: string): Promise<RetentionPolicy | undefined>;
  upsertRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy>;
  listQuotaBuckets(orgId: string): Promise<QuotaBucket[]>;
  createQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket>;
  updateQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket>;
  deleteQuotaBucket(quotaBucketId: string): Promise<QuotaBucket | undefined>;
  getBillingPlan(orgId: string): Promise<BillingPlan | undefined>;
  upsertBillingPlan(plan: BillingPlan): Promise<BillingPlan>;
  listResourceGrants(orgId: string): Promise<ResourceGrant[]>;
  createResourceGrant(grant: ResourceGrant): Promise<ResourceGrant>;
  deleteResourceGrantsForPrincipal(
    orgId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<ResourceGrant[]>;
  listPromptTemplates(
    orgId: string,
    workspaceId?: string,
  ): Promise<PromptTemplate[]>;
  getPromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplate | undefined>;
  createPromptTemplate(promptTemplate: PromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(promptTemplate: PromptTemplate): Promise<PromptTemplate>;
  deletePromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplate | undefined>;
  listResourceFavorites(
    orgId: string,
    userId: string,
  ): Promise<ResourceFavorite[]>;
  createResourceFavorite(favorite: ResourceFavorite): Promise<ResourceFavorite>;
  deleteResourceFavorite(
    favoriteId: string,
  ): Promise<ResourceFavorite | undefined>;
  listWorkspaceFolders(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkspaceFolder[]>;
  getWorkspaceFolder(folderId: string): Promise<WorkspaceFolder | undefined>;
  createWorkspaceFolder(folder: WorkspaceFolder): Promise<WorkspaceFolder>;
  updateWorkspaceFolder(folder: WorkspaceFolder): Promise<WorkspaceFolder>;
  deleteWorkspaceFolder(folderId: string): Promise<WorkspaceFolder | undefined>;
  listWorkspaceFolderItems(folderId: string): Promise<WorkspaceFolderItem[]>;
  createWorkspaceFolderItem(
    item: WorkspaceFolderItem,
  ): Promise<WorkspaceFolderItem>;
  deleteWorkspaceFolderItem(
    itemId: string,
  ): Promise<WorkspaceFolderItem | undefined>;
}

export interface TenantDataPurgeResult {
  organizationDeleted: boolean;
  recordCounts: Record<string, number>;
}

export interface RomeoRepositoryRuntime {
  driver: string;
  durable: boolean;
  storageScope: string;
  description: string;
}

export interface ClaimBackgroundJobInput {
  leaseSeconds: number;
  now?: string;
  orgId: string;
  payloadEquals?: Record<string, string>;
  type: string;
  workerId: string;
}

export interface RenewBackgroundJobLeaseInput {
  jobId: string;
  leaseSeconds: number;
  now?: string;
  orgId: string;
  workerId: string;
}

export function getRomeoRepositoryRuntime(
  repository: RomeoRepository,
): RomeoRepositoryRuntime {
  return (
    repository.runtime ?? {
      driver: "unknown",
      durable: false,
      storageScope: "unknown",
      description: "Repository does not expose runtime persistence metadata.",
    }
  );
}
