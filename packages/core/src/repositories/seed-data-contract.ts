import type { ResourceGrant } from "@romeo/auth";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { OrganizationCapabilityFlag } from "../domain/capability-flags";
import type { ContentPolicySeedData } from "../domain/content-policy";
import type {
  Agent,
  AgentKnowledgeBinding,
  AgentToolBinding,
  AgentVersion,
  ApiKey,
  AuditExportAttempt,
  AuditExportDestination,
  AuditExportIdempotencyReceipt,
  AuditExportJob,
  AuditIntegrityCheckpoint,
  AuditIntegrityRecord,
  AuditIntegrityTenantHead,
  AuditLog,
  BackgroundJob,
  BillingEventReceipt,
  BillingPlan,
  CapabilityAssignment,
  Chat,
  ChatComment,
  ChatTag,
  ChatTagAssignment,
  CollaborationChannel,
  CollaborationChannelMember,
  ContentDeletionOperation,
  DeviceAuthorization,
  EvalCase,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  FileObject,
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
  Group,
  GroupMembership,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeSource,
  LocalMfaChallenge,
  LocalMfaFactor,
  LocalPasswordCredential,
  ManagedModelCustomizationPolicyRecord,
  ManagedModelPreferenceRecord,
  Message,
  MessageFileReference,
  MessagePart,
  NotificationDelivery,
  NotificationDeliveryChannel,
  Organization,
  PromptTemplate,
  QuotaBucket,
  QueuedChatTurn,
  ResourceFavorite,
  RetentionPolicy,
  RunRecord,
  SamlAuthRequest,
  ServerTableSavedViewRecord,
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
  Workspace,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "../domain/entities";
import type { IdempotencyReceipt } from "../domain/idempotency";

export interface SeedData extends ContentPolicySeedData {
  organizations: Organization[];
  workspaces: Workspace[];
  users: User[];
  groups: Group[];
  groupMemberships: GroupMembership[];
  ssoOidcSettings: SsoOidcSettings[];
  systemSettings: SystemSetting[];
  apiKeys: ApiKey[];
  deviceAuthorizations: DeviceAuthorization[];
  userSessions: UserSession[];
  localPasswordCredentials: LocalPasswordCredential[];
  samlAuthRequests: SamlAuthRequest[];
  localMfaFactors: LocalMfaFactor[];
  localMfaChallenges: LocalMfaChallenge[];
  serviceAccounts: ServiceAccount[];
  providers: ProviderInstance[];
  models: BaseModel[];
  agents: Agent[];
  agentKnowledgeBindings: AgentKnowledgeBinding[];
  agentToolBindings: AgentToolBinding[];
  agentVersions: AgentVersion[];
  managedModelCustomizationPolicies: ManagedModelCustomizationPolicyRecord[];
  managedModelPreferences: ManagedModelPreferenceRecord[];
  evalSuites: EvalSuite[];
  evalCases: EvalCase[];
  evalRuns: EvalRun[];
  evalRunResults: EvalRunResult[];
  evalResultHumanRatings: EvalResultHumanRating[];
  chats: Chat[];
  queuedChatTurns: QueuedChatTurn[];
  messages: Message[];
  messageParts: MessagePart[];
  messageFileReferences: MessageFileReference[];
  /** Internal rollout marker; absent entries are legacy/read-both rows. */
  messagePartSchemaVersions: Record<string, 1>;
  fileObjects: FileObject[];
  contentDeletionOperations: ContentDeletionOperation[];
  chatComments: ChatComment[];
  chatTags: ChatTag[];
  chatTagAssignments: ChatTagAssignment[];
  collaborationChannels: CollaborationChannel[];
  collaborationChannelMembers: CollaborationChannelMember[];
  userNotifications: UserNotification[];
  notificationDeliveryChannels: NotificationDeliveryChannel[];
  notificationDeliveries: NotificationDelivery[];
  knowledgeBases: KnowledgeBase[];
  knowledgeSources: KnowledgeSource[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeChunkEmbeddings: KnowledgeChunkEmbedding[];
  voiceProfiles: VoiceProfile[];
  auditLogs: AuditLog[];
  auditIntegrityRecords: AuditIntegrityRecord[];
  auditIntegrityTenantHeads: AuditIntegrityTenantHead[];
  auditIntegrityCheckpoints: AuditIntegrityCheckpoint[];
  auditExportDestinations: AuditExportDestination[];
  auditExportJobs: AuditExportJob[];
  auditExportAttempts: AuditExportAttempt[];
  auditExportIdempotencyReceipts: AuditExportIdempotencyReceipt[];
  usageEvents: UsageEvent[];
  billingPlans: BillingPlan[];
  billingEventReceipts: BillingEventReceipt[];
  capabilityAssignments: CapabilityAssignment[];
  organizationCapabilityFlags: OrganizationCapabilityFlag[];
  idempotencyReceipts: IdempotencyReceipt[];
  backgroundJobs: BackgroundJob[];
  governanceExportJobs: GovernanceExportJobRecord[];
  governanceExportArtifacts: GovernanceExportArtifactRecord[];
  serverTableSavedViews: ServerTableSavedViewRecord[];
  webhookSubscriptions: WebhookSubscription[];
  webhookDeliveries: WebhookDelivery[];
  retentionPolicies: RetentionPolicy[];
  quotaBuckets: QuotaBucket[];
  runs: RunRecord[];
  toolCalls: ToolCallRecord[];
  toolConnectors: ToolConnector[];
  toolOperations: ToolOperation[];
  grants: ResourceGrant[];
  promptTemplates: PromptTemplate[];
  resourceFavorites: ResourceFavorite[];
  workspaceFolders: WorkspaceFolder[];
  workspaceFolderItems: WorkspaceFolderItem[];
}
