import type { PrincipalType, ResourceGrant } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type { DelegatedOAuthConnection } from "../domain/delegated-oauth";
import type {
  Agent,
  AgentKnowledgeBinding,
  AgentToolBinding,
  AgentVersion,
  ApiKey,
  AuditLog,
  BackgroundJob,
  BaseModel,
  BillingPlan,
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
  ResourceFavorite,
  RetentionPolicy,
  RunRecord,
  ServiceAccount,
  SsoOidcSettings,
  SystemSetting,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  UsageEvent,
  User,
  UserNotification,
  UserSession,
  VoiceProfile,
  WebhookDelivery,
  WebhookSubscription,
  WorkspaceFolder,
  WorkspaceFolderItem,
  WorkflowDefinition,
  WorkflowRun,
  Workspace,
} from "../domain/entities";
import type {
  ClaimBackgroundJobInput,
  RomeoRepository,
  RomeoRepositoryRuntime,
  RenewBackgroundJobLeaseInput,
  TenantDataPurgeResult,
} from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
import { listSeedResourceGrants } from "./resource-grants";
import { createSeedData, type SeedData } from "./seed-data";

export class InMemoryRomeoRepository implements RomeoRepository {
  readonly runtime: RomeoRepositoryRuntime = {
    driver: "memory",
    durable: false,
    storageScope: "process",
    description:
      "Process-local in-memory repository for tests and development.",
  };

  private readonly data: SeedData;
  private readonly delegatedOAuthRefreshLocks = new Map<
    string,
    Promise<void>
  >();
  private readonly runEvents = new Map<string, RunEvent[]>();

  constructor(seed: SeedData = createSeedData()) {
    this.data = seed;
  }

  async transaction<T>(
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T> {
    const dataSnapshot = structuredClone(this.data);
    const runEventsSnapshot = new Map(
      Array.from(this.runEvents.entries()).map(([runId, events]) => [
        runId,
        structuredClone(events),
      ]),
    );
    try {
      return await work(this);
    } catch (error) {
      restoreSeedData(this.data, dataSnapshot);
      this.runEvents.clear();
      for (const [runId, events] of runEventsSnapshot) {
        this.runEvents.set(runId, events);
      }
      throw error;
    }
  }

  async getCurrentUser(userId: string): Promise<User | undefined> {
    return this.data.users.find((user) => user.id === userId);
  }

  async listUsers(orgId: string): Promise<User[]> {
    return this.data.users
      .filter((user) => user.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createUser(user: User): Promise<User> {
    return append(this.data.users, user);
  }

  async updateUser(user: User): Promise<User> {
    return replaceById(this.data.users, user);
  }

  async listGroups(orgId: string): Promise<Group[]> {
    return this.data.groups
      .filter((group) => group.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getGroup(groupId: string): Promise<Group | undefined> {
    return this.data.groups.find((group) => group.id === groupId);
  }

  async createGroup(group: Group): Promise<Group> {
    const existing = this.data.groups.find(
      (item) => item.orgId === group.orgId && item.slug === group.slug,
    );
    return existing ?? append(this.data.groups, group);
  }

  async updateGroup(group: Group): Promise<Group> {
    return replaceById(this.data.groups, group);
  }

  async deleteGroup(groupId: string): Promise<Group | undefined> {
    const index = this.data.groups.findIndex((group) => group.id === groupId);
    if (index < 0) return undefined;
    return this.data.groups.splice(index, 1)[0];
  }

  async listGroupMemberships(
    orgId: string,
    groupId?: string,
    userId?: string,
  ): Promise<GroupMembership[]> {
    return this.data.groupMemberships
      .filter(
        (membership) =>
          membership.orgId === orgId &&
          (groupId === undefined || membership.groupId === groupId) &&
          (userId === undefined || membership.userId === userId),
      )
      .sort(
        (left, right) =>
          left.groupId.localeCompare(right.groupId) ||
          left.userId.localeCompare(right.userId),
      );
  }

  async createGroupMembership(
    membership: GroupMembership,
  ): Promise<GroupMembership> {
    const existing = this.data.groupMemberships.find(
      (item) =>
        item.groupId === membership.groupId &&
        item.userId === membership.userId,
    );
    return existing ?? append(this.data.groupMemberships, membership);
  }

  async deleteGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMembership | undefined> {
    const index = this.data.groupMemberships.findIndex(
      (membership) =>
        membership.groupId === groupId && membership.userId === userId,
    );
    if (index < 0) return undefined;
    return this.data.groupMemberships.splice(index, 1)[0];
  }

  async getSsoOidcSettings(
    orgId: string,
  ): Promise<SsoOidcSettings | undefined> {
    return this.data.ssoOidcSettings.find(
      (settings) => settings.orgId === orgId,
    );
  }

  async upsertSsoOidcSettings(
    settings: SsoOidcSettings,
  ): Promise<SsoOidcSettings> {
    const index = this.data.ssoOidcSettings.findIndex(
      (item) => item.orgId === settings.orgId,
    );
    if (index < 0) return append(this.data.ssoOidcSettings, settings);
    this.data.ssoOidcSettings[index] = settings;
    return settings;
  }

  async getSystemSetting(key: string): Promise<SystemSetting | undefined> {
    return this.data.systemSettings.find((setting) => setting.key === key);
  }

  async listSystemSettings(): Promise<SystemSetting[]> {
    return [...this.data.systemSettings].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  async upsertSystemSetting(setting: SystemSetting): Promise<SystemSetting> {
    const index = this.data.systemSettings.findIndex(
      (item) => item.key === setting.key,
    );
    if (index < 0) return append(this.data.systemSettings, setting);
    this.data.systemSettings[index] = setting;
    return setting;
  }

  async listOrganizations(orgId: string): Promise<Organization[]> {
    return this.data.organizations.filter((org) => org.id === orgId);
  }

  async listAllOrganizations(): Promise<Organization[]> {
    return [...this.data.organizations].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async getOrganization(orgId: string): Promise<Organization | undefined> {
    return this.data.organizations.find((org) => org.id === orgId);
  }

  async createOrganization(organization: Organization): Promise<Organization> {
    const existing = this.data.organizations.find(
      (org) => org.id === organization.id || org.slug === organization.slug,
    );
    return existing ?? append(this.data.organizations, organization);
  }

  async updateOrganization(organization: Organization): Promise<Organization> {
    return replaceById(this.data.organizations, organization);
  }

  async listWorkspaces(orgId: string): Promise<Workspace[]> {
    return this.data.workspaces.filter(
      (workspace) =>
        workspace.orgId === orgId && workspace.archivedAt === undefined,
    );
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    return this.data.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
  }

  async createWorkspace(workspace: Workspace): Promise<Workspace> {
    return append(this.data.workspaces, workspace);
  }

  async updateWorkspace(workspace: Workspace): Promise<Workspace> {
    return replaceById(this.data.workspaces, workspace);
  }

  async purgeTenantData(orgId: string): Promise<TenantDataPurgeResult> {
    const orgIds = new Set([orgId]);
    const workspaceIds = new Set(
      this.data.workspaces
        .filter((workspace) => workspace.orgId === orgId)
        .map((workspace) => workspace.id),
    );
    const userIds = new Set(
      this.data.users
        .filter((user) => user.orgId === orgId)
        .map((user) => user.id),
    );
    const groupIds = new Set(
      this.data.groups
        .filter((group) => group.orgId === orgId)
        .map((group) => group.id),
    );
    const providerIds = new Set(
      this.data.providers
        .filter((provider) => provider.orgId === orgId)
        .map((provider) => provider.id),
    );
    const modelIds = new Set(
      this.data.models
        .filter((model) => providerIds.has(model.providerId))
        .map((model) => model.id),
    );
    const agentIds = new Set(
      this.data.agents
        .filter((agent) => agent.orgId === orgId)
        .map((agent) => agent.id),
    );
    const evalSuiteIds = new Set(
      this.data.evalSuites
        .filter((suite) => suite.orgId === orgId)
        .map((suite) => suite.id),
    );
    const evalRunIds = new Set(
      this.data.evalRuns
        .filter((run) => run.orgId === orgId)
        .map((run) => run.id),
    );
    const evalResultIds = new Set(
      this.data.evalRunResults
        .filter((result) => result.orgId === orgId)
        .map((result) => result.id),
    );
    const chatIds = new Set(
      this.data.chats
        .filter((chat) => chat.orgId === orgId)
        .map((chat) => chat.id),
    );
    const messageIds = new Set(
      this.data.messages
        .filter((message) => chatIds.has(message.chatId))
        .map((message) => message.id),
    );
    const tagIds = new Set(
      this.data.chatTags
        .filter((tag) => tag.orgId === orgId)
        .map((tag) => tag.id),
    );
    const notificationIds = new Set(
      this.data.userNotifications
        .filter((notification) => notification.orgId === orgId)
        .map((notification) => notification.id),
    );
    const notificationChannelIds = new Set(
      this.data.notificationDeliveryChannels
        .filter((channel) => channel.orgId === orgId)
        .map((channel) => channel.id),
    );
    const knowledgeBaseIds = new Set(
      this.data.knowledgeBases
        .filter((base) => base.orgId === orgId)
        .map((base) => base.id),
    );
    const knowledgeSourceIds = new Set(
      this.data.knowledgeSources
        .filter((source) => source.orgId === orgId)
        .map((source) => source.id),
    );
    const knowledgeChunkIds = new Set(
      this.data.knowledgeChunks
        .filter((chunk) => chunk.orgId === orgId)
        .map((chunk) => chunk.id),
    );
    const dataConnectorIds = new Set(
      this.data.dataConnectors
        .filter((connector) => connector.orgId === orgId)
        .map((connector) => connector.id),
    );
    const runIds = new Set(
      this.data.runs.filter((run) => run.orgId === orgId).map((run) => run.id),
    );
    const toolConnectorIds = new Set(
      this.data.toolConnectors
        .filter((connector) => connector.orgId === orgId)
        .map((connector) => connector.id),
    );
    const toolOperationIds = new Set(
      this.data.toolOperations
        .filter(
          (operation) =>
            operation.orgId === orgId ||
            toolConnectorIds.has(operation.connectorId),
        )
        .map((operation) => operation.id),
    );
    const webhookSubscriptionIds = new Set(
      this.data.webhookSubscriptions
        .filter((subscription) => subscription.orgId === orgId)
        .map((subscription) => subscription.id),
    );
    const workflowDefinitionIds = new Set(
      this.data.workflowDefinitions
        .filter((definition) => definition.orgId === orgId)
        .map((definition) => definition.id),
    );
    const folderIds = new Set(
      this.data.workspaceFolders
        .filter((folder) => folder.orgId === orgId)
        .map((folder) => folder.id),
    );
    const fileIds = new Set(
      this.data.fileObjects
        .filter((file) => file.orgId === orgId)
        .map((file) => file.id),
    );
    const promptTemplateIds = new Set(
      this.data.promptTemplates
        .filter((template) => template.orgId === orgId)
        .map((template) => template.id),
    );
    const serviceAccountIds = new Set(
      this.data.serviceAccounts
        .filter((account) => account.orgId === orgId)
        .map((account) => account.id),
    );
    const voiceProfileIds = new Set(
      this.data.voiceProfiles
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
      ...dataConnectorIds,
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
    ): void => {
      const values = this.data[key] as T[];
      const kept = values.filter((item) => !predicate(item));
      counts[String(key)] = values.length - kept.length;
      (this.data as Record<keyof SeedData, unknown>)[key] = kept;
    };

    let runEventCount = 0;
    for (const runId of runIds) {
      runEventCount += this.runEvents.get(runId)?.length ?? 0;
      this.runEvents.delete(runId);
    }
    counts.runEvents = runEventCount;

    remove<SystemSetting>(
      "systemSettings",
      (setting) =>
        setting.value.orgId === orgId ||
        orgScopedSystemSettingKeys(orgId).has(setting.key),
    );
    remove<WorkflowRun>(
      "workflowRuns",
      (run) => run.orgId === orgId || workflowDefinitionIds.has(run.workflowId),
    );
    remove<WebhookDelivery>(
      "webhookDeliveries",
      (delivery) =>
        delivery.orgId === orgId ||
        webhookSubscriptionIds.has(delivery.subscriptionId),
    );
    remove<NotificationDelivery>(
      "notificationDeliveries",
      (delivery) =>
        delivery.orgId === orgId ||
        notificationIds.has(delivery.notificationId) ||
        notificationChannelIds.has(delivery.channelId),
    );
    remove<MessagePart>("messageParts", (part) =>
      messageIds.has(part.messageId),
    );
    remove<Message>("messages", (message) => chatIds.has(message.chatId));
    remove<ChatComment>(
      "chatComments",
      (comment) => comment.orgId === orgId || chatIds.has(comment.chatId),
    );
    remove<ChatTagAssignment>(
      "chatTagAssignments",
      (assignment) =>
        assignment.orgId === orgId ||
        chatIds.has(assignment.chatId) ||
        tagIds.has(assignment.tagId),
    );
    remove<CollaborationChannelMember>(
      "collaborationChannelMembers",
      (member) => member.orgId === orgId,
    );
    remove<ToolCallRecord>(
      "toolCalls",
      (call) => call.orgId === orgId || runIds.has(call.runId ?? ""),
    );
    remove<UsageEvent>("usageEvents", (event) => event.orgId === orgId);
    remove<ResourceGrant>(
      "grants",
      (grant) =>
        tenantResourceIds.has(grant.resourceId) ||
        tenantPrincipalIds.has(grant.principalId),
    );
    remove<ResourceFavorite>(
      "resourceFavorites",
      (favorite) => favorite.orgId === orgId,
    );
    remove<WorkspaceFolderItem>(
      "workspaceFolderItems",
      (item) => item.orgId === orgId || folderIds.has(item.folderId),
    );
    remove<AgentKnowledgeBinding>(
      "agentKnowledgeBindings",
      (binding) =>
        binding.orgId === orgId ||
        agentIds.has(binding.agentId) ||
        knowledgeBaseIds.has(binding.knowledgeBaseId),
    );
    remove<AgentToolBinding>(
      "agentToolBindings",
      (binding) => binding.orgId === orgId || agentIds.has(binding.agentId),
    );
    remove<EvalResultHumanRating>(
      "evalResultHumanRatings",
      (rating) =>
        rating.orgId === orgId ||
        evalRunIds.has(rating.runId) ||
        evalResultIds.has(rating.resultId),
    );
    remove<EvalRunResult>(
      "evalRunResults",
      (result) => result.orgId === orgId || evalRunIds.has(result.runId),
    );
    remove<EvalRun>(
      "evalRuns",
      (run) => run.orgId === orgId || evalSuiteIds.has(run.suiteId),
    );
    remove<EvalCase>(
      "evalCases",
      (testCase) =>
        testCase.orgId === orgId || evalSuiteIds.has(testCase.suiteId),
    );
    remove<RunRecord>("runs", (run) => run.orgId === orgId);
    remove<KnowledgeChunkEmbedding>(
      "knowledgeChunkEmbeddings",
      (embedding) =>
        embedding.orgId === orgId ||
        knowledgeBaseIds.has(embedding.knowledgeBaseId) ||
        knowledgeSourceIds.has(embedding.sourceId) ||
        knowledgeChunkIds.has(embedding.chunkId),
    );
    remove<KnowledgeChunk>(
      "knowledgeChunks",
      (chunk) =>
        chunk.orgId === orgId ||
        knowledgeBaseIds.has(chunk.knowledgeBaseId) ||
        knowledgeSourceIds.has(chunk.sourceId),
    );
    remove<KnowledgeSource>(
      "knowledgeSources",
      (source) =>
        source.orgId === orgId || knowledgeBaseIds.has(source.knowledgeBaseId),
    );
    remove<DataConnectorSync>(
      "dataConnectorSyncs",
      (sync) => sync.orgId === orgId || dataConnectorIds.has(sync.connectorId),
    );
    remove<DeviceAuthorization>(
      "deviceAuthorizations",
      (authorization) =>
        authorization.orgId === orgId || userIds.has(authorization.userId),
    );
    remove<ApiKey>("apiKeys", (apiKey) => apiKey.orgId === orgId);
    remove<LocalMfaFactor>(
      "localMfaFactors",
      (factor) => factor.orgId === orgId || userIds.has(factor.userId),
    );
    remove<LocalPasswordCredential>(
      "localPasswordCredentials",
      (credential) =>
        credential.orgId === orgId || userIds.has(credential.userId),
    );
    remove<UserSession>(
      "userSessions",
      (session) => session.orgId === orgId || userIds.has(session.userId),
    );
    remove<ServiceAccount>(
      "serviceAccounts",
      (account) => account.orgId === orgId,
    );
    remove<GroupMembership>(
      "groupMemberships",
      (membership) =>
        membership.orgId === orgId ||
        groupIds.has(membership.groupId) ||
        userIds.has(membership.userId),
    );
    remove<DelegatedOAuthConnection>(
      "delegatedOAuthConnections",
      (connection) =>
        connection.orgId === orgId ||
        userIds.has(connection.userId) ||
        workspaceIds.has(connection.workspaceId),
    );
    remove<CollaborationChannel>(
      "collaborationChannels",
      (channel) =>
        channel.orgId === orgId ||
        workspaceIds.has(channel.workspaceId) ||
        userIds.has(channel.userId),
    );
    remove<UserNotification>(
      "userNotifications",
      (notification) =>
        notification.orgId === orgId || userIds.has(notification.userId),
    );
    remove<NotificationDeliveryChannel>(
      "notificationDeliveryChannels",
      (channel) => channel.orgId === orgId || userIds.has(channel.userId),
    );
    remove<WebhookSubscription>(
      "webhookSubscriptions",
      (subscription) => subscription.orgId === orgId,
    );
    remove<WorkflowDefinition>(
      "workflowDefinitions",
      (definition) => definition.orgId === orgId,
    );
    remove<DataConnector>(
      "dataConnectors",
      (connector) => connector.orgId === orgId,
    );
    remove<KnowledgeBase>(
      "knowledgeBases",
      (base) => base.orgId === orgId || workspaceIds.has(base.workspaceId),
    );
    remove<FileObject>("fileObjects", (file) => file.orgId === orgId);
    remove<PromptTemplate>(
      "promptTemplates",
      (template) => template.orgId === orgId,
    );
    remove<WorkspaceFolder>(
      "workspaceFolders",
      (folder) => folder.orgId === orgId,
    );
    remove<ChatTag>("chatTags", (tag) => tag.orgId === orgId);
    remove<Chat>("chats", (chat) => chat.orgId === orgId);
    remove<AgentVersion>(
      "agentVersions",
      (version) =>
        version.orgId === orgId ||
        agentIds.has(version.agentId) ||
        modelIds.has(version.baseModelId),
    );
    remove<Agent>("agents", (agent) => agent.orgId === orgId);
    remove<EvalSuite>(
      "evalSuites",
      (suite) => suite.orgId === orgId || agentIds.has(suite.agentId),
    );
    remove<ToolOperation>(
      "toolOperations",
      (operation) =>
        operation.orgId === orgId ||
        toolConnectorIds.has(operation.connectorId),
    );
    remove<ToolConnector>(
      "toolConnectors",
      (connector) => connector.orgId === orgId,
    );
    remove<BaseModel>(
      "models",
      (model) => modelIds.has(model.id) || providerIds.has(model.providerId),
    );
    remove<ProviderInstance>(
      "providers",
      (provider) => provider.orgId === orgId,
    );
    remove<VoiceProfile>("voiceProfiles", (profile) => profile.orgId === orgId);
    remove<QuotaBucket>("quotaBuckets", (bucket) => bucket.orgId === orgId);
    remove<BillingPlan>("billingPlans", (plan) => plan.orgId === orgId);
    remove<RetentionPolicy>(
      "retentionPolicies",
      (policy) => policy.orgId === orgId,
    );
    remove<SsoOidcSettings>(
      "ssoOidcSettings",
      (settings) => settings.orgId === orgId,
    );
    remove<AuditLog>("auditLogs", (log) => log.orgId === orgId);
    remove<Group>("groups", (group) => group.orgId === orgId);
    remove<User>("users", (user) => user.orgId === orgId);
    remove<Workspace>("workspaces", (workspace) => workspace.orgId === orgId);
    remove<Organization>("organizations", (organization) =>
      orgIds.has(organization.id),
    );

    return {
      organizationDeleted: (counts.organizations ?? 0) > 0,
      recordCounts: counts,
    };
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    return this.data.apiKeys
      .filter((apiKey) => apiKey.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getApiKey(apiKeyId: string): Promise<ApiKey | undefined> {
    return this.data.apiKeys.find((apiKey) => apiKey.id === apiKeyId);
  }

  async getApiKeyByHash(hashedToken: string): Promise<ApiKey | undefined> {
    return this.data.apiKeys.find(
      (apiKey) => apiKey.hashedToken === hashedToken,
    );
  }

  async createApiKey(apiKey: ApiKey): Promise<ApiKey> {
    return append(this.data.apiKeys, apiKey);
  }

  async updateApiKey(apiKey: ApiKey): Promise<ApiKey> {
    return replaceById(this.data.apiKeys, apiKey);
  }

  async listDeviceAuthorizations(
    orgId: string,
    userId: string,
  ): Promise<DeviceAuthorization[]> {
    return this.data.deviceAuthorizations
      .filter(
        (authorization) =>
          authorization.orgId === orgId && authorization.userId === userId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getDeviceAuthorization(
    deviceAuthorizationId: string,
  ): Promise<DeviceAuthorization | undefined> {
    return this.data.deviceAuthorizations.find(
      (authorization) => authorization.id === deviceAuthorizationId,
    );
  }

  async getDeviceAuthorizationByRefreshHash(
    hashedRefreshToken: string,
  ): Promise<DeviceAuthorization | undefined> {
    return this.data.deviceAuthorizations.find(
      (authorization) =>
        authorization.hashedRefreshToken === hashedRefreshToken,
    );
  }

  async createDeviceAuthorization(
    authorization: DeviceAuthorization,
  ): Promise<DeviceAuthorization> {
    return append(this.data.deviceAuthorizations, authorization);
  }

  async updateDeviceAuthorization(
    authorization: DeviceAuthorization,
  ): Promise<DeviceAuthorization> {
    return replaceById(this.data.deviceAuthorizations, authorization);
  }

  async listUserSessions(
    orgId: string,
    userId: string,
  ): Promise<UserSession[]> {
    return this.data.userSessions
      .filter((session) => session.orgId === orgId && session.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getUserSession(sessionId: string): Promise<UserSession | undefined> {
    return this.data.userSessions.find((session) => session.id === sessionId);
  }

  async getUserSessionByHash(
    hashedToken: string,
  ): Promise<UserSession | undefined> {
    return this.data.userSessions.find(
      (session) => session.hashedToken === hashedToken,
    );
  }

  async createUserSession(session: UserSession): Promise<UserSession> {
    return append(this.data.userSessions, session);
  }

  async updateUserSession(session: UserSession): Promise<UserSession> {
    return replaceById(this.data.userSessions, session);
  }

  async getLocalPasswordCredentialByUserId(
    userId: string,
  ): Promise<LocalPasswordCredential | undefined> {
    return this.data.localPasswordCredentials.find(
      (credential) => credential.userId === userId,
    );
  }

  async getLocalPasswordCredentialByEmail(
    orgId: string,
    emailNormalized: string,
  ): Promise<LocalPasswordCredential | undefined> {
    return this.data.localPasswordCredentials.find(
      (credential) =>
        credential.orgId === orgId &&
        credential.emailNormalized === emailNormalized,
    );
  }

  async createLocalPasswordCredential(
    credential: LocalPasswordCredential,
  ): Promise<LocalPasswordCredential> {
    const existing = this.data.localPasswordCredentials.find(
      (item) =>
        item.orgId === credential.orgId && item.userId === credential.userId,
    );
    return existing ?? append(this.data.localPasswordCredentials, credential);
  }

  async updateLocalPasswordCredential(
    credential: LocalPasswordCredential,
  ): Promise<LocalPasswordCredential> {
    return replaceById(this.data.localPasswordCredentials, credential);
  }

  async listLocalMfaFactors(
    orgId: string,
    userId: string,
  ): Promise<LocalMfaFactor[]> {
    return this.data.localMfaFactors
      .filter((factor) => factor.orgId === orgId && factor.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listLocalMfaFactorsForOrg(orgId: string): Promise<LocalMfaFactor[]> {
    return this.data.localMfaFactors
      .filter((factor) => factor.orgId === orgId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getLocalMfaFactor(
    factorId: string,
  ): Promise<LocalMfaFactor | undefined> {
    return this.data.localMfaFactors.find((factor) => factor.id === factorId);
  }

  async createLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor> {
    return append(this.data.localMfaFactors, factor);
  }

  async updateLocalMfaFactor(factor: LocalMfaFactor): Promise<LocalMfaFactor> {
    return replaceById(this.data.localMfaFactors, factor);
  }

  async listServiceAccounts(orgId: string): Promise<ServiceAccount[]> {
    return this.data.serviceAccounts
      .filter((account) => account.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getServiceAccount(
    serviceAccountId: string,
  ): Promise<ServiceAccount | undefined> {
    return this.data.serviceAccounts.find(
      (account) => account.id === serviceAccountId,
    );
  }

  async createServiceAccount(
    serviceAccount: ServiceAccount,
  ): Promise<ServiceAccount> {
    return append(this.data.serviceAccounts, serviceAccount);
  }

  async updateServiceAccount(
    serviceAccount: ServiceAccount,
  ): Promise<ServiceAccount> {
    return replaceById(this.data.serviceAccounts, serviceAccount);
  }

  async listProviders(orgId: string): Promise<ProviderInstance[]> {
    return this.data.providers
      .filter((provider) => provider.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getProvider(providerId: string): Promise<ProviderInstance | undefined> {
    return this.data.providers.find((provider) => provider.id === providerId);
  }

  async createProvider(provider: ProviderInstance): Promise<ProviderInstance> {
    return append(this.data.providers, provider);
  }

  async listModels(orgId: string): Promise<BaseModel[]> {
    const providerIds = new Set(
      this.data.providers
        .filter((provider) => provider.orgId === orgId)
        .map((provider) => provider.id),
    );
    return this.data.models
      .filter((model) => providerIds.has(model.providerId))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async getModel(modelId: string): Promise<BaseModel | undefined> {
    return this.data.models.find((model) => model.id === modelId);
  }

  async updateModel(model: BaseModel): Promise<BaseModel> {
    return replaceById(this.data.models, model);
  }

  async upsertModels(models: BaseModel[]): Promise<BaseModel[]> {
    for (const model of models) {
      const index = this.data.models.findIndex((item) => item.id === model.id);
      if (index >= 0) {
        this.data.models[index] = model;
      } else {
        this.data.models.push(model);
      }
    }

    return models;
  }

  async listAgents(workspaceId: string): Promise<Agent[]> {
    return this.data.agents.filter(
      (agent) => agent.workspaceId === workspaceId,
    );
  }

  async createAgent(agent: Agent): Promise<Agent> {
    return append(this.data.agents, agent);
  }

  async updateAgent(agent: Agent): Promise<Agent> {
    return replaceById(this.data.agents, agent);
  }

  async getAgent(agentId: string): Promise<Agent | undefined> {
    return this.data.agents.find((agent) => agent.id === agentId);
  }

  async listAgentKnowledgeBindings(
    agentId: string,
  ): Promise<AgentKnowledgeBinding[]> {
    return this.data.agentKnowledgeBindings.filter(
      (binding) => binding.agentId === agentId,
    );
  }

  async upsertAgentKnowledgeBinding(
    binding: AgentKnowledgeBinding,
  ): Promise<AgentKnowledgeBinding> {
    const index = this.data.agentKnowledgeBindings.findIndex(
      (item) =>
        item.agentId === binding.agentId &&
        item.knowledgeBaseId === binding.knowledgeBaseId,
    );
    if (index >= 0) this.data.agentKnowledgeBindings[index] = binding;
    else this.data.agentKnowledgeBindings.push(binding);
    return binding;
  }

  async listAgentToolBindings(agentId: string): Promise<AgentToolBinding[]> {
    return this.data.agentToolBindings.filter(
      (binding) => binding.agentId === agentId,
    );
  }

  async upsertAgentToolBinding(
    binding: AgentToolBinding,
  ): Promise<AgentToolBinding> {
    const index = this.data.agentToolBindings.findIndex(
      (item) =>
        item.agentId === binding.agentId && item.toolId === binding.toolId,
    );
    if (index >= 0) this.data.agentToolBindings[index] = binding;
    else this.data.agentToolBindings.push(binding);
    return binding;
  }

  async listAgentVersions(agentId: string): Promise<AgentVersion[]> {
    return this.data.agentVersions
      .filter((version) => version.agentId === agentId)
      .sort((left, right) => right.version - left.version);
  }

  async getAgentVersion(versionId: string): Promise<AgentVersion | undefined> {
    return this.data.agentVersions.find((version) => version.id === versionId);
  }

  async createAgentVersion(version: AgentVersion): Promise<AgentVersion> {
    return append(this.data.agentVersions, version);
  }

  async listEvalSuites(agentId: string): Promise<EvalSuite[]> {
    return this.data.evalSuites
      .filter((suite) => suite.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getEvalSuite(suiteId: string): Promise<EvalSuite | undefined> {
    return this.data.evalSuites.find((suite) => suite.id === suiteId);
  }

  async createEvalSuite(suite: EvalSuite): Promise<EvalSuite> {
    return append(this.data.evalSuites, suite);
  }

  async listEvalCases(suiteId: string): Promise<EvalCase[]> {
    return this.data.evalCases.filter(
      (testCase) => testCase.suiteId === suiteId,
    );
  }

  async createEvalCases(cases: EvalCase[]): Promise<EvalCase[]> {
    return appendMany(this.data.evalCases, cases);
  }

  async listEvalRuns(agentId: string): Promise<EvalRun[]> {
    return this.data.evalRuns
      .filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getEvalRun(runId: string): Promise<EvalRun | undefined> {
    return this.data.evalRuns.find((run) => run.id === runId);
  }

  async createEvalRun(run: EvalRun): Promise<EvalRun> {
    return append(this.data.evalRuns, run);
  }

  async getEvalRunResult(resultId: string): Promise<EvalRunResult | undefined> {
    return this.data.evalRunResults.find((result) => result.id === resultId);
  }

  async listEvalRunResults(runId: string): Promise<EvalRunResult[]> {
    return this.data.evalRunResults.filter((result) => result.runId === runId);
  }

  async createEvalRunResults(
    results: EvalRunResult[],
  ): Promise<EvalRunResult[]> {
    return appendMany(this.data.evalRunResults, results);
  }

  async listEvalResultHumanRatings(
    runId: string,
  ): Promise<EvalResultHumanRating[]> {
    return this.data.evalResultHumanRatings
      .filter((rating) => rating.runId === runId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getEvalResultHumanRating(
    resultId: string,
    reviewerId: string,
  ): Promise<EvalResultHumanRating | undefined> {
    return this.data.evalResultHumanRatings.find(
      (rating) =>
        rating.resultId === resultId && rating.reviewerId === reviewerId,
    );
  }

  async upsertEvalResultHumanRating(
    rating: EvalResultHumanRating,
  ): Promise<EvalResultHumanRating> {
    const index = this.data.evalResultHumanRatings.findIndex(
      (item) =>
        item.resultId === rating.resultId &&
        item.reviewerId === rating.reviewerId,
    );
    if (index >= 0) this.data.evalResultHumanRatings[index] = rating;
    else this.data.evalResultHumanRatings.push(rating);
    return rating;
  }

  async listChats(workspaceId: string): Promise<Chat[]> {
    return this.data.chats
      .filter((chat) => chat.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async createChat(chat: Chat): Promise<Chat> {
    return append(this.data.chats, chat);
  }

  async updateChat(chat: Chat): Promise<Chat> {
    return replaceById(this.data.chats, chat);
  }

  async getChat(chatId: string): Promise<Chat | undefined> {
    return this.data.chats.find((chat) => chat.id === chatId);
  }

  async listMessages(chatId: string): Promise<Message[]> {
    return this.data.messages
      .filter((message) => message.chatId === chatId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getMessage(messageId: string): Promise<Message | undefined> {
    return this.data.messages.find((message) => message.id === messageId);
  }

  async createMessage(message: Message): Promise<Message> {
    return append(this.data.messages, message);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const index = this.data.messages.findIndex(
      (message) => message.id === messageId,
    );
    if (index >= 0) this.data.messages.splice(index, 1);
    this.data.messageParts = this.data.messageParts.filter(
      (part) => part.messageId !== messageId,
    );
  }

  async listMessageParts(messageId: string): Promise<MessagePart[]> {
    return this.data.messageParts.filter(
      (part) => part.messageId === messageId,
    );
  }

  async getMessagePart(
    messagePartId: string,
  ): Promise<MessagePart | undefined> {
    return this.data.messageParts.find((part) => part.id === messagePartId);
  }

  async createMessageParts(parts: MessagePart[]): Promise<MessagePart[]> {
    return appendMany(this.data.messageParts, parts);
  }

  async listFileObjects(
    orgId: string,
    workspaceId?: string,
  ): Promise<FileObject[]> {
    return this.data.fileObjects
      .filter((file) => file.orgId === orgId)
      .filter(
        (file) => workspaceId === undefined || file.workspaceId === workspaceId,
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getFileObject(fileId: string): Promise<FileObject | undefined> {
    return this.data.fileObjects.find((file) => file.id === fileId);
  }

  async createFileObject(file: FileObject): Promise<FileObject> {
    return append(this.data.fileObjects, file);
  }

  async updateFileObject(file: FileObject): Promise<FileObject> {
    return replaceById(this.data.fileObjects, file);
  }

  async listChatComments(chatId: string): Promise<ChatComment[]> {
    return this.data.chatComments
      .filter((comment) => comment.chatId === chatId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createChatComment(comment: ChatComment): Promise<ChatComment> {
    return append(this.data.chatComments, comment);
  }

  async listChatTags(orgId: string, userId: string): Promise<ChatTag[]> {
    return this.data.chatTags
      .filter((tag) => tag.orgId === orgId && tag.userId === userId)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }

  async listChatTagsForChat(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<ChatTag[]> {
    const tagIds = new Set(
      this.data.chatTagAssignments
        .filter(
          (assignment) =>
            assignment.orgId === orgId &&
            assignment.userId === userId &&
            assignment.chatId === chatId,
        )
        .map((assignment) => assignment.tagId),
    );
    return this.data.chatTags
      .filter((tag) => tag.orgId === orgId && tagIds.has(tag.id))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }

  async listChatIdsByTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<string[]> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return [];
    return this.data.chatTagAssignments
      .filter(
        (assignment) =>
          assignment.orgId === orgId &&
          assignment.userId === userId &&
          assignment.tagId === tag.id,
      )
      .map((assignment) => assignment.chatId)
      .sort();
  }

  async upsertChatTag(tag: ChatTag): Promise<ChatTag> {
    const index = this.data.chatTags.findIndex(
      (item) =>
        item.orgId === tag.orgId &&
        item.userId === tag.userId &&
        item.slug === tag.slug,
    );
    if (index < 0) return append(this.data.chatTags, tag);
    const existing = this.data.chatTags[index]!;
    const updated = {
      ...existing,
      name: tag.name,
      updatedAt: tag.updatedAt,
      ...(tag.meta === undefined ? {} : { meta: tag.meta }),
    };
    this.data.chatTags[index] = updated;
    return updated;
  }

  async createChatTagAssignment(
    assignment: ChatTagAssignment,
  ): Promise<ChatTagAssignment> {
    const existing = this.data.chatTagAssignments.find(
      (item) =>
        item.orgId === assignment.orgId &&
        item.userId === assignment.userId &&
        item.chatId === assignment.chatId &&
        item.tagId === assignment.tagId,
    );
    return existing ?? append(this.data.chatTagAssignments, assignment);
  }

  async deleteChatTagAssignment(
    orgId: string,
    userId: string,
    chatId: string,
    slug: string,
  ): Promise<ChatTagAssignment | undefined> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return undefined;
    const index = this.data.chatTagAssignments.findIndex(
      (assignment) =>
        assignment.orgId === orgId &&
        assignment.userId === userId &&
        assignment.chatId === chatId &&
        assignment.tagId === tag.id,
    );
    if (index < 0) return undefined;
    return this.data.chatTagAssignments.splice(index, 1)[0];
  }

  async countChatTagAssignments(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<number> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return 0;
    return this.data.chatTagAssignments.filter(
      (assignment) =>
        assignment.orgId === orgId &&
        assignment.userId === userId &&
        assignment.tagId === tag.id,
    ).length;
  }

  async deleteChatTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<ChatTag | undefined> {
    const index = this.data.chatTags.findIndex(
      (tag) =>
        tag.orgId === orgId && tag.userId === userId && tag.slug === slug,
    );
    if (index < 0) return undefined;
    const [deleted] = this.data.chatTags.splice(index, 1);
    if (deleted !== undefined) {
      this.data.chatTagAssignments = this.data.chatTagAssignments.filter(
        (assignment) => assignment.tagId !== deleted.id,
      );
    }
    return deleted;
  }

  async listCollaborationChannels(
    orgId: string,
  ): Promise<CollaborationChannel[]> {
    return this.data.collaborationChannels
      .filter((channel) => channel.orgId === orgId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined> {
    return this.data.collaborationChannels.find(
      (channel) => channel.id === channelId,
    );
  }

  async createCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel> {
    return append(this.data.collaborationChannels, channel);
  }

  async updateCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel> {
    return replaceById(this.data.collaborationChannels, channel);
  }

  async deleteCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined> {
    const deleted = removeById(this.data.collaborationChannels, channelId);
    if (deleted !== undefined) {
      this.data.collaborationChannelMembers =
        this.data.collaborationChannelMembers.filter(
          (member) => member.channelId !== channelId,
        );
    }
    return deleted;
  }

  async listCollaborationChannelMembers(
    orgId: string,
    channelId?: string,
    userId?: string,
  ): Promise<CollaborationChannelMember[]> {
    return this.data.collaborationChannelMembers
      .filter(
        (member) =>
          member.orgId === orgId &&
          (channelId === undefined || member.channelId === channelId) &&
          (userId === undefined || member.userId === userId),
      )
      .sort(
        (left, right) =>
          left.channelId.localeCompare(right.channelId) ||
          left.userId.localeCompare(right.userId),
      );
  }

  async getCollaborationChannelMember(
    channelId: string,
    userId: string,
  ): Promise<CollaborationChannelMember | undefined> {
    return this.data.collaborationChannelMembers.find(
      (member) => member.channelId === channelId && member.userId === userId,
    );
  }

  async createCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember> {
    const existing = await this.getCollaborationChannelMember(
      member.channelId,
      member.userId,
    );
    return existing ?? append(this.data.collaborationChannelMembers, member);
  }

  async updateCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember> {
    return replaceById(this.data.collaborationChannelMembers, member);
  }

  async deleteCollaborationChannelMembers(
    channelId: string,
    userIds: string[],
  ): Promise<CollaborationChannelMember[]> {
    const userIdSet = new Set(userIds);
    const deleted = this.data.collaborationChannelMembers.filter(
      (member) =>
        member.channelId === channelId && userIdSet.has(member.userId),
    );
    this.data.collaborationChannelMembers =
      this.data.collaborationChannelMembers.filter(
        (member) =>
          member.channelId !== channelId || !userIdSet.has(member.userId),
      );
    return deleted;
  }

  async listUserNotifications(
    orgId: string,
    userId: string,
  ): Promise<UserNotification[]> {
    return this.data.userNotifications
      .filter(
        (notification) =>
          notification.orgId === orgId && notification.userId === userId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification> {
    return append(this.data.userNotifications, notification);
  }

  async updateUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification> {
    return replaceById(this.data.userNotifications, notification);
  }

  async listNotificationDeliveryChannels(
    orgId: string,
    userId: string,
  ): Promise<NotificationDeliveryChannel[]> {
    return this.data.notificationDeliveryChannels
      .filter((channel) => channel.orgId === orgId && channel.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createNotificationDeliveryChannel(
    channel: NotificationDeliveryChannel,
  ): Promise<NotificationDeliveryChannel> {
    return append(this.data.notificationDeliveryChannels, channel);
  }

  async listNotificationDeliveries(
    orgId: string,
    userId: string,
  ): Promise<NotificationDelivery[]> {
    return this.data.notificationDeliveries
      .filter(
        (delivery) => delivery.orgId === orgId && delivery.userId === userId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery> {
    return append(this.data.notificationDeliveries, delivery);
  }

  async updateNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery> {
    return replaceById(this.data.notificationDeliveries, delivery);
  }

  async listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]> {
    return this.data.knowledgeBases.filter(
      (knowledgeBase) => knowledgeBase.workspaceId === workspaceId,
    );
  }

  async createKnowledgeBase(
    knowledgeBase: KnowledgeBase,
  ): Promise<KnowledgeBase> {
    return append(this.data.knowledgeBases, knowledgeBase);
  }

  async updateKnowledgeBase(
    knowledgeBase: KnowledgeBase,
  ): Promise<KnowledgeBase> {
    return replaceById(this.data.knowledgeBases, knowledgeBase);
  }

  async getKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<KnowledgeBase | undefined> {
    return this.data.knowledgeBases.find(
      (knowledgeBase) => knowledgeBase.id === knowledgeBaseId,
    );
  }

  async listKnowledgeSources(
    knowledgeBaseId: string,
  ): Promise<KnowledgeSource[]> {
    return this.data.knowledgeSources.filter(
      (source) => source.knowledgeBaseId === knowledgeBaseId,
    );
  }

  async createKnowledgeSource(
    source: KnowledgeSource,
  ): Promise<KnowledgeSource> {
    return append(this.data.knowledgeSources, source);
  }

  async updateKnowledgeSource(
    source: KnowledgeSource,
  ): Promise<KnowledgeSource> {
    return replaceById(this.data.knowledgeSources, source);
  }

  async deleteKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSource | undefined> {
    return removeById(this.data.knowledgeSources, sourceId);
  }

  async listKnowledgeChunks(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunk[]> {
    return this.data.knowledgeChunks
      .filter((chunk) => chunk.knowledgeBaseId === knowledgeBaseId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async createKnowledgeChunks(
    chunks: KnowledgeChunk[],
  ): Promise<KnowledgeChunk[]> {
    return appendMany(this.data.knowledgeChunks, chunks);
  }

  async deleteKnowledgeChunksForSource(sourceId: string): Promise<void> {
    this.data.knowledgeChunks = this.data.knowledgeChunks.filter(
      (chunk) => chunk.sourceId !== sourceId,
    );
    this.data.knowledgeChunkEmbeddings =
      this.data.knowledgeChunkEmbeddings.filter(
        (embedding) => embedding.sourceId !== sourceId,
      );
  }

  async listKnowledgeChunkEmbeddings(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunkEmbedding[]> {
    return this.data.knowledgeChunkEmbeddings
      .filter((embedding) => embedding.knowledgeBaseId === knowledgeBaseId)
      .sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  }

  async searchKnowledgeChunkEmbeddings(input: {
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    embeddingProvider: string;
    embeddingModel: string;
    dimensions: number;
    queryEmbedding: number[];
    maxResults: number;
  }): Promise<KnowledgeChunkEmbeddingSearchHit[]> {
    return this.data.knowledgeChunkEmbeddings
      .filter(
        (embedding) =>
          embedding.orgId === input.orgId &&
          embedding.workspaceId === input.workspaceId &&
          embedding.knowledgeBaseId === input.knowledgeBaseId &&
          embedding.embeddingProvider === input.embeddingProvider &&
          embedding.embeddingModel === input.embeddingModel &&
          embedding.dimensions === input.dimensions,
      )
      .map((embedding) => ({
        embedding,
        score: cosineSimilarity(embedding.embedding, input.queryEmbedding),
      }))
      .filter((hit) => hit.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.embedding.chunkId.localeCompare(right.embedding.chunkId),
      )
      .slice(0, input.maxResults);
  }

  async upsertKnowledgeChunkEmbeddings(
    embeddings: KnowledgeChunkEmbedding[],
  ): Promise<KnowledgeChunkEmbedding[]> {
    for (const embedding of embeddings) {
      const index = this.data.knowledgeChunkEmbeddings.findIndex(
        (item) =>
          item.chunkId === embedding.chunkId &&
          item.embeddingProvider === embedding.embeddingProvider &&
          item.embeddingModel === embedding.embeddingModel,
      );
      if (index >= 0) this.data.knowledgeChunkEmbeddings[index] = embedding;
      else this.data.knowledgeChunkEmbeddings.push(embedding);
    }
    return embeddings;
  }

  async deleteKnowledgeChunkEmbeddingsForSource(
    sourceId: string,
  ): Promise<void> {
    this.data.knowledgeChunkEmbeddings =
      this.data.knowledgeChunkEmbeddings.filter(
        (embedding) => embedding.sourceId !== sourceId,
      );
  }

  async listDataConnectors(
    orgId: string,
    workspaceId?: string,
  ): Promise<DataConnector[]> {
    return this.data.dataConnectors
      .filter(
        (connector) =>
          connector.orgId === orgId &&
          (workspaceId === undefined || connector.workspaceId === workspaceId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getDataConnector(
    connectorId: string,
  ): Promise<DataConnector | undefined> {
    return this.data.dataConnectors.find(
      (connector) => connector.id === connectorId,
    );
  }

  async createDataConnector(connector: DataConnector): Promise<DataConnector> {
    return append(this.data.dataConnectors, connector);
  }

  async updateDataConnector(connector: DataConnector): Promise<DataConnector> {
    return replaceById(this.data.dataConnectors, connector);
  }

  async listDataConnectorSyncs(
    orgId: string,
    connectorId?: string,
  ): Promise<DataConnectorSync[]> {
    return this.data.dataConnectorSyncs
      .filter(
        (sync) =>
          sync.orgId === orgId &&
          (connectorId === undefined || sync.connectorId === connectorId),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createDataConnectorSync(
    sync: DataConnectorSync,
  ): Promise<DataConnectorSync> {
    return append(this.data.dataConnectorSyncs, sync);
  }

  async updateDataConnectorSync(
    sync: DataConnectorSync,
  ): Promise<DataConnectorSync> {
    return replaceById(this.data.dataConnectorSyncs, sync);
  }

  async listDelegatedOAuthConnections(
    orgId: string,
    workspaceId?: string,
    userId?: string,
  ): Promise<DelegatedOAuthConnection[]> {
    return this.data.delegatedOAuthConnections
      .filter(
        (connection) =>
          connection.orgId === orgId &&
          (workspaceId === undefined ||
            connection.workspaceId === workspaceId) &&
          (userId === undefined || connection.userId === userId),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getDelegatedOAuthConnection(
    connectionId: string,
  ): Promise<DelegatedOAuthConnection | undefined> {
    return this.data.delegatedOAuthConnections.find(
      (connection) => connection.id === connectionId,
    );
  }

  async getDelegatedOAuthConnectionByProviderAccount(input: {
    connectorType: DelegatedOAuthConnection["connectorType"];
    orgId: string;
    providerAccountId: string;
    providerId: DelegatedOAuthConnection["providerId"];
    userId: string;
    workspaceId: string;
  }): Promise<DelegatedOAuthConnection | undefined> {
    return this.data.delegatedOAuthConnections.find(
      (connection) =>
        connection.orgId === input.orgId &&
        connection.workspaceId === input.workspaceId &&
        connection.userId === input.userId &&
        connection.providerId === input.providerId &&
        connection.connectorType === input.connectorType &&
        connection.providerAccountId === input.providerAccountId,
    );
  }

  async createDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection> {
    return append(this.data.delegatedOAuthConnections, connection);
  }

  async updateDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection> {
    return replaceById(this.data.delegatedOAuthConnections, connection);
  }

  async withDelegatedOAuthConnectionRefreshLock<T>(
    connectionId: string,
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T> {
    const previous =
      this.delegatedOAuthRefreshLocks.get(connectionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.delegatedOAuthRefreshLocks.set(connectionId, next);
    await previous.catch(() => undefined);
    try {
      return await work(this);
    } finally {
      release();
      if (this.delegatedOAuthRefreshLocks.get(connectionId) === next) {
        this.delegatedOAuthRefreshLocks.delete(connectionId);
      }
    }
  }

  async listVoiceProfiles(orgId: string): Promise<VoiceProfile[]> {
    return this.data.voiceProfiles
      .filter((voice) => voice.orgId === orgId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getVoiceProfile(
    voiceProfileId: string,
  ): Promise<VoiceProfile | undefined> {
    return this.data.voiceProfiles.find((voice) => voice.id === voiceProfileId);
  }

  async createVoiceProfile(voiceProfile: VoiceProfile): Promise<VoiceProfile> {
    const index = this.data.voiceProfiles.findIndex(
      (item) =>
        item.orgId === voiceProfile.orgId &&
        item.providerId === voiceProfile.providerId &&
        item.providerVoiceId === voiceProfile.providerVoiceId,
    );
    if (index >= 0) {
      const existing = this.data.voiceProfiles[index]!;
      const updated = {
        ...voiceProfile,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      this.data.voiceProfiles[index] = updated;
      return updated;
    }
    return append(this.data.voiceProfiles, voiceProfile);
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    return append(this.data.runs, run);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.data.runs.find((run) => run.id === runId);
  }

  async updateRun(run: RunRecord): Promise<RunRecord> {
    return replaceById(this.data.runs, run);
  }

  async appendRunEvents(events: RunEvent[]): Promise<void> {
    for (const event of events) {
      const existing = this.runEvents.get(event.runId) ?? [];
      existing.push(event);
      this.runEvents.set(event.runId, existing);
    }
  }

  async listRunEvents(runId: string): Promise<RunEvent[]> {
    return this.runEvents.get(runId) ?? [];
  }

  async listToolCalls(orgId: string): Promise<ToolCallRecord[]> {
    return this.data.toolCalls
      .filter((call) => call.orgId === orgId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createToolCall(call: ToolCallRecord): Promise<ToolCallRecord> {
    return append(this.data.toolCalls, call);
  }

  async listToolConnectors(orgId: string): Promise<ToolConnector[]> {
    return this.data.toolConnectors.filter(
      (connector) => connector.orgId === orgId,
    );
  }

  async createToolConnector(connector: ToolConnector): Promise<ToolConnector> {
    return append(this.data.toolConnectors, connector);
  }

  async updateToolConnector(connector: ToolConnector): Promise<ToolConnector> {
    return replaceById(this.data.toolConnectors, connector);
  }

  async listToolOperations(connectorId: string): Promise<ToolOperation[]> {
    return this.data.toolOperations.filter(
      (operation) => operation.connectorId === connectorId,
    );
  }

  async createToolOperations(
    operations: ToolOperation[],
  ): Promise<ToolOperation[]> {
    return appendMany(this.data.toolOperations, operations);
  }

  async updateToolOperation(operation: ToolOperation): Promise<ToolOperation> {
    return replaceById(this.data.toolOperations, operation);
  }

  async listAuditLogs(orgId: string): Promise<AuditLog[]> {
    return this.data.auditLogs
      .filter((log) => log.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createAuditLog(log: AuditLog): Promise<AuditLog> {
    return append(this.data.auditLogs, log);
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    const initialCount = this.data.auditLogs.length;
    this.data.auditLogs = this.data.auditLogs.filter(
      (log) => log.orgId !== orgId || log.createdAt >= before,
    );
    return initialCount - this.data.auditLogs.length;
  }

  async getDataDeletionPlan(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
  ): Promise<DataDeletionPlan | undefined> {
    if (resourceType === "chat")
      return this.chatDeletionPlan(orgId, resourceId);
    if (resourceType === "file_object")
      return this.fileObjectDeletionPlan(orgId, resourceId);
    if (resourceType === "knowledge_source")
      return this.knowledgeSourceDeletionPlan(orgId, resourceId);
    return undefined;
  }

  async deleteDataForResource(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
  ): Promise<DataDeletionPlan | undefined> {
    if (resourceType === "file_object")
      return this.deleteFileObjectForDataDeletion(orgId, resourceId);
    if (resourceType === "knowledge_source") return undefined;
    if (resourceType !== "chat") return undefined;

    const plan = await this.getDataDeletionPlan(
      orgId,
      resourceType,
      resourceId,
    );
    if (!plan) return undefined;

    const runIds = new Set(
      this.data.runs
        .filter((run) => run.orgId === orgId && run.chatId === resourceId)
        .map((run) => run.id),
    );
    const messageIds = new Set(
      this.data.messages
        .filter((message) => message.chatId === resourceId)
        .map((message) => message.id),
    );
    const notificationIds = new Set(
      this.data.userNotifications
        .filter(
          (notification) =>
            notification.orgId === orgId &&
            notification.resourceType === "chat" &&
            notification.resourceId === resourceId,
        )
        .map((notification) => notification.id),
    );

    this.data.messageParts = this.data.messageParts.filter(
      (part) => !messageIds.has(part.messageId),
    );
    this.data.chats = this.data.chats.filter(
      (chat) => !(chat.orgId === orgId && chat.id === resourceId),
    );
    this.data.messages = this.data.messages.filter(
      (message) => message.chatId !== resourceId,
    );
    this.data.runs = this.data.runs.filter(
      (run) => !(run.orgId === orgId && run.chatId === resourceId),
    );
    this.data.chatComments = this.data.chatComments.filter(
      (comment) => !(comment.orgId === orgId && comment.chatId === resourceId),
    );
    this.data.chatTagAssignments = this.data.chatTagAssignments.filter(
      (assignment) =>
        !(assignment.orgId === orgId && assignment.chatId === resourceId),
    );
    this.data.userNotifications = this.data.userNotifications.filter(
      (notification) => !notificationIds.has(notification.id),
    );
    this.data.notificationDeliveries = this.data.notificationDeliveries.filter(
      (delivery) => !notificationIds.has(delivery.notificationId),
    );
    this.data.toolCalls = this.data.toolCalls.filter(
      (call) => call.runId === undefined || !runIds.has(call.runId),
    );
    this.data.usageEvents = this.data.usageEvents.filter(
      (event) =>
        !isChatDeletionUsageEvent(event, runIds, messageIds, resourceId),
    );
    this.data.grants = this.data.grants.filter(
      (grant) =>
        !(grant.resourceType === "chat" && grant.resourceId === resourceId),
    );
    this.data.resourceFavorites = this.data.resourceFavorites.filter(
      (favorite) =>
        !(
          favorite.orgId === orgId &&
          favorite.resourceType === "chat" &&
          favorite.resourceId === resourceId
        ),
    );
    this.data.workspaceFolderItems = this.data.workspaceFolderItems.filter(
      (item) =>
        !(
          item.orgId === orgId &&
          item.resourceType === "chat" &&
          item.resourceId === resourceId
        ),
    );
    for (const runId of runIds) this.runEvents.delete(runId);

    return plan;
  }

  async listUsageEvents(orgId: string): Promise<UsageEvent[]> {
    return this.data.usageEvents
      .filter((event) => event.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createUsageEvent(event: UsageEvent): Promise<UsageEvent> {
    return append(this.data.usageEvents, event);
  }

  async updateUsageEvent(event: UsageEvent): Promise<UsageEvent> {
    this.data.usageEvents = this.data.usageEvents.map((candidate) =>
      candidate.id === event.id ? event : candidate,
    );
    return event;
  }

  async listBackgroundJobs(orgId: string): Promise<BackgroundJob[]> {
    return this.data.backgroundJobs
      .filter((job) => job.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createBackgroundJob(job: BackgroundJob): Promise<BackgroundJob> {
    return append(this.data.backgroundJobs, job);
  }

  async claimBackgroundJob(
    input: ClaimBackgroundJobInput,
  ): Promise<BackgroundJob | undefined> {
    const now = input.now ?? new Date().toISOString();
    const staleBeforeMs =
      Date.parse(now) - Math.max(1, input.leaseSeconds) * 1000;
    const job = this.data.backgroundJobs
      .filter((item) => item.orgId === input.orgId && item.type === input.type)
      .filter((item) => payloadEquals(item.payload, input.payloadEquals))
      .filter(
        (item) =>
          item.status === "queued" ||
          (item.status === "running" &&
            Date.parse(item.updatedAt) <= staleBeforeMs),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )[0];
    if (job === undefined) return undefined;
    return this.updateBackgroundJob(applyWorkerLease(job, input, now));
  }

  async renewBackgroundJobLease(
    input: RenewBackgroundJobLeaseInput,
  ): Promise<BackgroundJob | undefined> {
    const job = this.data.backgroundJobs.find(
      (item) => item.id === input.jobId && item.orgId === input.orgId,
    );
    if (job === undefined || job.status !== "running") return undefined;
    const now = input.now ?? new Date().toISOString();
    const lease = readWorkerLease(job.payload);
    if (
      lease === undefined ||
      lease.workerId !== input.workerId ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    ) {
      return undefined;
    }
    return this.updateBackgroundJob(renewWorkerLease(job, input, now, lease));
  }

  async updateBackgroundJob(job: BackgroundJob): Promise<BackgroundJob> {
    return replaceById(this.data.backgroundJobs, job);
  }

  async listWebhookSubscriptions(
    orgId: string,
  ): Promise<WebhookSubscription[]> {
    return this.data.webhookSubscriptions
      .filter((subscription) => subscription.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createWebhookSubscription(
    subscription: WebhookSubscription,
  ): Promise<WebhookSubscription> {
    return append(this.data.webhookSubscriptions, subscription);
  }

  async updateWebhookSubscription(
    subscription: WebhookSubscription,
  ): Promise<WebhookSubscription> {
    return replaceById(this.data.webhookSubscriptions, subscription);
  }

  async getWebhookSubscription(
    subscriptionId: string,
  ): Promise<WebhookSubscription | undefined> {
    return this.data.webhookSubscriptions.find(
      (subscription) => subscription.id === subscriptionId,
    );
  }

  async listWebhookDeliveries(
    orgId: string,
    subscriptionId?: string,
  ): Promise<WebhookDelivery[]> {
    return this.data.webhookDeliveries
      .filter(
        (delivery) =>
          delivery.orgId === orgId &&
          (subscriptionId === undefined ||
            delivery.subscriptionId === subscriptionId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createWebhookDelivery(
    delivery: WebhookDelivery,
  ): Promise<WebhookDelivery> {
    return append(this.data.webhookDeliveries, delivery);
  }

  async updateWebhookDelivery(
    delivery: WebhookDelivery,
  ): Promise<WebhookDelivery> {
    return replaceById(this.data.webhookDeliveries, delivery);
  }

  async listWorkflowDefinitions(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkflowDefinition[]> {
    return this.data.workflowDefinitions
      .filter(
        (workflow) =>
          workflow.orgId === orgId &&
          (workspaceId === undefined || workflow.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getWorkflowDefinition(
    workflowId: string,
  ): Promise<WorkflowDefinition | undefined> {
    return this.data.workflowDefinitions.find(
      (workflow) => workflow.id === workflowId,
    );
  }

  async createWorkflowDefinition(
    workflow: WorkflowDefinition,
  ): Promise<WorkflowDefinition> {
    return append(this.data.workflowDefinitions, workflow);
  }

  async updateWorkflowDefinition(
    workflow: WorkflowDefinition,
  ): Promise<WorkflowDefinition> {
    return replaceById(this.data.workflowDefinitions, workflow);
  }

  async listWorkflowRuns(
    orgId: string,
    workflowId?: string,
  ): Promise<WorkflowRun[]> {
    return this.data.workflowRuns
      .filter(
        (run) =>
          run.orgId === orgId &&
          (workflowId === undefined || run.workflowId === workflowId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getWorkflowRun(
    workflowRunId: string,
  ): Promise<WorkflowRun | undefined> {
    return this.data.workflowRuns.find((run) => run.id === workflowRunId);
  }

  async createWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
    return append(this.data.workflowRuns, run);
  }

  async updateWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
    return replaceById(this.data.workflowRuns, run);
  }

  async getRetentionPolicy(
    orgId: string,
  ): Promise<RetentionPolicy | undefined> {
    return this.data.retentionPolicies.find((policy) => policy.orgId === orgId);
  }

  async upsertRetentionPolicy(
    policy: RetentionPolicy,
  ): Promise<RetentionPolicy> {
    const index = this.data.retentionPolicies.findIndex(
      (item) => item.orgId === policy.orgId,
    );
    if (index >= 0) this.data.retentionPolicies[index] = policy;
    else this.data.retentionPolicies.push(policy);
    return policy;
  }

  async listQuotaBuckets(orgId: string): Promise<QuotaBucket[]> {
    return this.data.quotaBuckets
      .filter((bucket) => bucket.orgId === orgId)
      .sort((left, right) => left.metric.localeCompare(right.metric));
  }

  async createQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket> {
    return append(this.data.quotaBuckets, bucket);
  }

  async updateQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket> {
    return replaceById(this.data.quotaBuckets, bucket);
  }

  async deleteQuotaBucket(
    quotaBucketId: string,
  ): Promise<QuotaBucket | undefined> {
    return removeById(this.data.quotaBuckets, quotaBucketId);
  }

  async getBillingPlan(orgId: string): Promise<BillingPlan | undefined> {
    return this.data.billingPlans.find((plan) => plan.orgId === orgId);
  }

  async upsertBillingPlan(plan: BillingPlan): Promise<BillingPlan> {
    const index = this.data.billingPlans.findIndex(
      (item) => item.orgId === plan.orgId,
    );
    if (index >= 0) this.data.billingPlans[index] = plan;
    else this.data.billingPlans.push(plan);
    return plan;
  }

  async listResourceGrants(orgId: string): Promise<ResourceGrant[]> {
    return listSeedResourceGrants(this.data, orgId);
  }

  async createResourceGrant(grant: ResourceGrant): Promise<ResourceGrant> {
    return append(this.data.grants, grant);
  }

  async deleteResourceGrantsForPrincipal(
    orgId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<ResourceGrant[]> {
    const orgGrantIds = new Set(
      listSeedResourceGrants(this.data, orgId)
        .filter(
          (grant) =>
            grant.principalType === principalType &&
            grant.principalId === principalId,
        )
        .map((grant) => grant.id),
    );
    const deleted: ResourceGrant[] = [];
    for (let index = this.data.grants.length - 1; index >= 0; index -= 1) {
      const grant = this.data.grants[index];
      if (grant !== undefined && orgGrantIds.has(grant.id)) {
        deleted.push(...this.data.grants.splice(index, 1));
      }
    }
    return deleted.reverse();
  }

  async listPromptTemplates(
    orgId: string,
    workspaceId?: string,
  ): Promise<PromptTemplate[]> {
    return this.data.promptTemplates
      .filter(
        (template) =>
          template.orgId === orgId &&
          (workspaceId === undefined || template.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getPromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplate | undefined> {
    return this.data.promptTemplates.find(
      (template) => template.id === promptTemplateId,
    );
  }

  async createPromptTemplate(
    promptTemplate: PromptTemplate,
  ): Promise<PromptTemplate> {
    return append(this.data.promptTemplates, promptTemplate);
  }

  async updatePromptTemplate(
    promptTemplate: PromptTemplate,
  ): Promise<PromptTemplate> {
    return replaceById(this.data.promptTemplates, promptTemplate);
  }

  async deletePromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplate | undefined> {
    return removeById(this.data.promptTemplates, promptTemplateId);
  }

  async listResourceFavorites(
    orgId: string,
    userId: string,
  ): Promise<ResourceFavorite[]> {
    return this.data.resourceFavorites.filter(
      (favorite) => favorite.orgId === orgId && favorite.userId === userId,
    );
  }

  async createResourceFavorite(
    favorite: ResourceFavorite,
  ): Promise<ResourceFavorite> {
    return append(this.data.resourceFavorites, favorite);
  }

  async deleteResourceFavorite(
    favoriteId: string,
  ): Promise<ResourceFavorite | undefined> {
    return removeById(this.data.resourceFavorites, favoriteId);
  }

  async listWorkspaceFolders(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkspaceFolder[]> {
    return this.data.workspaceFolders
      .filter(
        (folder) =>
          folder.orgId === orgId &&
          (workspaceId === undefined || folder.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getWorkspaceFolder(
    folderId: string,
  ): Promise<WorkspaceFolder | undefined> {
    return this.data.workspaceFolders.find((folder) => folder.id === folderId);
  }

  async createWorkspaceFolder(
    folder: WorkspaceFolder,
  ): Promise<WorkspaceFolder> {
    return append(this.data.workspaceFolders, folder);
  }

  async updateWorkspaceFolder(
    folder: WorkspaceFolder,
  ): Promise<WorkspaceFolder> {
    return replaceById(this.data.workspaceFolders, folder);
  }

  async deleteWorkspaceFolder(
    folderId: string,
  ): Promise<WorkspaceFolder | undefined> {
    const deleted = removeById(this.data.workspaceFolders, folderId);
    if (deleted !== undefined) {
      this.data.workspaceFolderItems = this.data.workspaceFolderItems.filter(
        (item) => item.folderId !== folderId,
      );
    }
    return deleted;
  }

  async listWorkspaceFolderItems(
    folderId: string,
  ): Promise<WorkspaceFolderItem[]> {
    return this.data.workspaceFolderItems
      .filter((item) => item.folderId === folderId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createWorkspaceFolderItem(
    item: WorkspaceFolderItem,
  ): Promise<WorkspaceFolderItem> {
    const existing = this.data.workspaceFolderItems.find(
      (candidate) =>
        candidate.folderId === item.folderId &&
        candidate.resourceType === item.resourceType &&
        candidate.resourceId === item.resourceId,
    );
    return existing ?? append(this.data.workspaceFolderItems, item);
  }

  async deleteWorkspaceFolderItem(
    itemId: string,
  ): Promise<WorkspaceFolderItem | undefined> {
    return removeById(this.data.workspaceFolderItems, itemId);
  }

  private chatDeletionPlan(
    orgId: string,
    chatId: string,
  ): DataDeletionPlan | undefined {
    const chat = this.data.chats.find(
      (item) => item.orgId === orgId && item.id === chatId,
    );
    if (!chat) return undefined;

    const runIds = new Set(
      this.data.runs
        .filter((run) => run.orgId === orgId && run.chatId === chatId)
        .map((run) => run.id),
    );
    const messageIds = new Set(
      this.data.messages
        .filter((message) => message.chatId === chatId)
        .map((message) => message.id),
    );
    const notificationIds = new Set(
      this.data.userNotifications
        .filter(
          (notification) =>
            notification.orgId === orgId &&
            notification.resourceType === "chat" &&
            notification.resourceId === chatId,
        )
        .map((notification) => notification.id),
    );

    const legalHold = activeLegalHold(chat);
    return {
      orgId,
      workspaceId: chat.workspaceId,
      resourceType: "chat",
      resourceId: chat.id,
      ...(legalHold !== undefined ? { legalHold } : {}),
      counts: {
        ...emptyDataDeletionCounts(),
        chats: 1,
        messages: messageIds.size,
        messageParts: this.data.messageParts.filter((part) =>
          messageIds.has(part.messageId),
        ).length,
        runs: runIds.size,
        runSteps: 0,
        runEvents: Array.from(runIds).reduce(
          (count, runId) => count + (this.runEvents.get(runId)?.length ?? 0),
          0,
        ),
        chatComments: this.data.chatComments.filter(
          (comment) => comment.orgId === orgId && comment.chatId === chatId,
        ).length,
        userNotifications: notificationIds.size,
        notificationDeliveries: this.data.notificationDeliveries.filter(
          (delivery) => notificationIds.has(delivery.notificationId),
        ).length,
        runLinkedToolCalls: this.data.toolCalls.filter(
          (call) => call.runId !== undefined && runIds.has(call.runId),
        ).length,
        usageEvents: this.data.usageEvents.filter((event) =>
          isChatDeletionUsageEvent(event, runIds, messageIds, chatId),
        ).length,
        resourceGrants: this.data.grants.filter(
          (grant) =>
            grant.resourceType === "chat" && grant.resourceId === chatId,
        ).length,
        resourceFavorites: this.data.resourceFavorites.filter(
          (favorite) =>
            favorite.orgId === orgId &&
            favorite.resourceType === "chat" &&
            favorite.resourceId === chatId,
        ).length,
        workspaceFolderItems: this.data.workspaceFolderItems.filter(
          (item) =>
            item.orgId === orgId &&
            item.resourceType === "chat" &&
            item.resourceId === chatId,
        ).length,
      },
    };
  }

  private fileObjectDeletionPlan(
    orgId: string,
    fileId: string,
  ): DataDeletionPlan | undefined {
    const file = this.data.fileObjects.find(
      (item) =>
        item.orgId === orgId && item.id === fileId && item.status !== "deleted",
    );
    if (file === undefined) return undefined;
    return {
      orgId,
      workspaceId: file.workspaceId,
      resourceType: "file_object",
      resourceId: file.id,
      counts: {
        ...emptyDataDeletionCounts(),
        resourceGrants: this.data.grants.filter(
          (grant) =>
            grant.resourceType === "file" && grant.resourceId === file.id,
        ).length,
        fileObjects: 1,
        objectStoreObjects: fileObjectStorageObjectCount(file.metadata),
        objectStoreBytes: file.sizeBytes,
      },
    };
  }

  private async deleteFileObjectForDataDeletion(
    orgId: string,
    fileId: string,
  ): Promise<DataDeletionPlan | undefined> {
    const plan = this.fileObjectDeletionPlan(orgId, fileId);
    if (plan === undefined) return undefined;
    const now = new Date().toISOString();
    this.data.fileObjects = this.data.fileObjects.map((file) =>
      file.orgId === orgId && file.id === fileId
        ? {
            ...file,
            status: "deleted",
            deletedAt: now,
            updatedAt: now,
          }
        : file,
    );
    this.data.grants = this.data.grants.filter(
      (grant) =>
        !(grant.resourceType === "file" && grant.resourceId === fileId),
    );
    return plan;
  }

  private knowledgeSourceDeletionPlan(
    orgId: string,
    sourceId: string,
  ): DataDeletionPlan | undefined {
    const source = this.data.knowledgeSources.find(
      (item) => item.orgId === orgId && item.id === sourceId,
    );
    if (source === undefined) return undefined;
    return {
      orgId,
      workspaceId: source.workspaceId,
      resourceType: "knowledge_source",
      resourceId: source.id,
      knowledgeBaseId: source.knowledgeBaseId,
      counts: {
        ...emptyDataDeletionCounts(),
        knowledgeSources: 1,
        knowledgeChunks: this.data.knowledgeChunks.filter(
          (chunk) => chunk.sourceId === source.id,
        ).length,
        knowledgeEmbeddings: this.data.knowledgeChunkEmbeddings.filter(
          (embedding) => embedding.sourceId === source.id,
        ).length,
        objectStoreObjects: source.objectKey === undefined ? 0 : 1,
        objectStoreBytes: source.objectKey === undefined ? 0 : source.sizeBytes,
      },
    };
  }
}

function payloadEquals(
  payload: Record<string, unknown>,
  expected: Record<string, string> | undefined,
): boolean {
  if (expected === undefined) return true;
  return Object.entries(expected).every(
    ([key, value]) => payload[key] === value,
  );
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export const defaultRepository = new InMemoryRomeoRepository();

function restoreSeedData(target: SeedData, snapshot: SeedData): void {
  for (const key of Object.keys(snapshot) as Array<keyof SeedData>) {
    target[key] = snapshot[key] as never;
  }
}

function isChatDeletionUsageEvent(
  event: UsageEvent,
  runIds: Set<string>,
  messageIds: Set<string>,
  chatId: string,
): boolean {
  if (event.sourceType === "run" && runIds.has(event.sourceId)) return true;
  if (event.sourceType !== "voice") return false;
  return (
    event.metadata.chatId === chatId ||
    (typeof event.metadata.messageId === "string" &&
      messageIds.has(event.metadata.messageId))
  );
}

function emptyDataDeletionCounts(): DataDeletionPlan["counts"] {
  return {
    chats: 0,
    messages: 0,
    messageParts: 0,
    runs: 0,
    runSteps: 0,
    runEvents: 0,
    chatComments: 0,
    userNotifications: 0,
    notificationDeliveries: 0,
    runLinkedToolCalls: 0,
    usageEvents: 0,
    resourceGrants: 0,
    resourceFavorites: 0,
    workspaceFolderItems: 0,
    fileObjects: 0,
    knowledgeSources: 0,
    knowledgeChunks: 0,
    knowledgeEmbeddings: 0,
    objectStoreObjects: 0,
    objectStoreBytes: 0,
  };
}

function fileObjectStorageObjectCount(
  metadata: Record<string, unknown>,
): number {
  if (metadata.uploadMode !== "resumable_backend_composed") return 1;
  const partCount = metadata.partCount;
  return typeof partCount === "number" &&
    Number.isInteger(partCount) &&
    partCount > 0
    ? partCount + 1
    : 1;
}

function activeLegalHold(
  chat: Chat,
): DataDeletionPlan["legalHold"] | undefined {
  if (chat.legalHoldUntil === undefined) return undefined;
  if (new Date(chat.legalHoldUntil).getTime() <= Date.now()) return undefined;
  return {
    until: chat.legalHoldUntil,
    ...(chat.legalHoldReason !== undefined
      ? { reason: chat.legalHoldReason }
      : {}),
  };
}

interface WorkerLeasePayload {
  attempt: number;
  claimedAt: string;
  expiresAt: string;
  leaseSeconds: number;
  renewedAt: string;
  workerId: string;
}

function applyWorkerLease(
  job: BackgroundJob,
  input: ClaimBackgroundJobInput,
  now: string,
): BackgroundJob {
  const previousLease = readWorkerLease(job.payload);
  return {
    ...job,
    status: "running",
    payload: {
      ...job.payload,
      workerLease: {
        attempt: (previousLease?.attempt ?? 0) + 1,
        claimedAt: now,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
        workerId: input.workerId,
      },
    },
    updatedAt: now,
  };
}

function renewWorkerLease(
  job: BackgroundJob,
  input: RenewBackgroundJobLeaseInput,
  now: string,
  lease: WorkerLeasePayload,
): BackgroundJob {
  return {
    ...job,
    payload: {
      ...job.payload,
      workerLease: {
        ...lease,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
      },
    },
    updatedAt: now,
  };
}

function readWorkerLease(
  payload: Record<string, unknown>,
): WorkerLeasePayload | undefined {
  const value = payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as Partial<WorkerLeasePayload>;
  if (
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  ) {
    return undefined;
  }
  return {
    attempt: lease.attempt,
    claimedAt: lease.claimedAt,
    expiresAt: lease.expiresAt,
    leaseSeconds: lease.leaseSeconds,
    renewedAt: lease.renewedAt,
    workerId: lease.workerId,
  };
}

function leaseExpiresAt(now: string, leaseSeconds: number): string {
  return new Date(
    Date.parse(now) + Math.max(1, leaseSeconds) * 1000,
  ).toISOString();
}

function orgScopedSystemSettingKeys(orgId: string): Set<string> {
  const encodedOrgId = encodeURIComponent(orgId);
  return new Set([
    `abuse_controls.org.v1:${orgId}`,
    `auth_provider_settings.org.v1:${orgId}`,
    `governance.data_export_packages.${encodedOrgId}`,
    `notification_policy.org.v1:${orgId}`,
    `rag_policy.change_request.org.v1:${orgId}`,
    `rag_policy.org.v1:${orgId}`,
    `tenant_lifecycle.deletion_finalization_evidence.v1:${orgId}`,
    `tenant_lifecycle.deletion_request.v1:${orgId}`,
  ]);
}
