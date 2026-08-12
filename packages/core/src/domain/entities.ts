import type { BaseModel, ProviderInstance } from "@romeo/providers";
import type { Scope } from "@romeo/auth";

export type * from "./agent-entities";
export type * from "./identity-entities";

export interface Chat {
  agentId?: string;
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  modelId?: string;
  temporary?: boolean;
  expiresAt?: string;
  createdBy: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
  activeLeafMessageId?: string;
  updatedAt: string;
}

export interface ChatTag {
  id: string;
  orgId: string;
  userId: string;
  slug: string;
  name: string;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTagAssignment {
  id: string;
  orgId: string;
  userId: string;
  chatId: string;
  tagId: string;
  createdAt: string;
}

export interface CollaborationChannel {
  id: string;
  orgId: string;
  workspaceId: string;
  userId: string;
  type?: string;
  name: string;
  description?: string;
  isPrivate?: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface CollaborationChannelMember {
  id: string;
  orgId: string;
  channelId: string;
  userId: string;
  role?: string;
  status?: string;
  isActive: boolean;
  isChannelMuted: boolean;
  isChannelPinned: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  invitedAt?: string;
  invitedBy?: string;
  joinedAt: string;
  leftAt?: string;
  lastReadAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRunError {
  code: string;
  message?: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  citations?: MessageCitation[];
  attachments?: MessageAttachment[];
  /** Inline run failure shown in place of a normal assistant answer. */
  error?: MessageRunError;
  /** Model that produced this assistant turn. */
  modelId?: string;
  parentId?: string;
  createdAt: string;
}

export interface MessageCitation {
  chunkId: string;
  documentId: string;
  title: string;
  sourceUri?: string;
  sourceType?: string;
  provider?: string;
  retrievedAt?: string;
  accessedAt?: string;
  publishedAt?: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "document" | "image";
  retainedInContext: boolean;
  previewUrl?: string;
}

export interface MessagePart {
  id: string;
  messageId: string;
  type: "attachment" | "collaboration_channel_metadata";
  content: string;
  metadata: Record<string, unknown>;
}

export type MessageFeedbackRating = "negative" | "positive";

export interface MessageFeedbackState {
  chatId: string;
  messageId: string;
  configured: boolean;
  rating?: MessageFeedbackRating;
  reasonCode?: string;
  createdAt?: string;
  updatedAt?: string;
  redaction: {
    freeTextReturned: false;
    messageContentReturned: false;
    rawUsageMetadataReturned: false;
    reviewerIdentityReturned: false;
  };
}

export type FileObjectPurpose =
  | "browser_artifact"
  | "chat_attachment"
  | "connector_import"
  | "export_bundle"
  | "general"
  | "generated_image"
  | "knowledge_source"
  | "memory"
  | "note"
  | "web_source"
  | "voice_artifact";

export type FileObjectStatus = "available" | "deleted" | "uploading";

export interface FileObject {
  id: string;
  orgId: string;
  workspaceId: string;
  ownerType: "service_account" | "user";
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  purpose: FileObjectPurpose;
  status: FileObjectStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface VoiceProfile {
  id: string;
  orgId: string;
  providerId: string;
  providerVoiceId: string;
  name: string;
  language: string;
  styleTags: string[];
  cloningAllowed: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  dependentAgentCount?: number;
  grantCount?: number;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "success" | "failure";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageEvent {
  id: string;
  orgId: string;
  workspaceId?: string;
  actorId: string;
  sourceType: "chat" | "retrieval" | "run" | "tool" | "storage" | "voice";
  sourceId: string;
  metric: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummaryMetric {
  metric: string;
  quantity: number;
  unit: string;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  totals: UsageSummaryMetric[];
  byActor: Array<UsageSummaryMetric & { actorId: string }>;
  byProvider: Array<UsageSummaryMetric & { providerId: string }>;
}

export interface UsageAlert {
  id: string;
  scopeType: QuotaBucket["scopeType"];
  scopeId: string;
  metric: string;
  used: number;
  limit: number;
  percentUsed: number;
  severity: "warning" | "critical" | "exceeded";
  resetAt?: string;
}

export type QuotaMetric =
  | "image.cost.micro_usd"
  | "image.generated"
  | "web.search.request"
  | "web.url.fetch"
  | "run.started"
  | "tool.call"
  | "storage.byte";

export interface BillingPlanQuotaTemplate {
  metric: QuotaMetric;
  limit: number;
  resetInterval: QuotaBucket["resetInterval"];
}

export interface BillingPlan {
  id: string;
  orgId: string;
  code: string;
  name: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  source: "external" | "manual";
  quotaTemplates: BillingPlanQuotaTemplate[];
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  orgId: string;
  workspaceId?: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface QuotaBucket {
  id: string;
  orgId: string;
  scopeType: "org" | "user" | "workspace" | "provider" | "agent" | "api_key";
  scopeId: string;
  metric: QuotaMetric;
  limit: number;
  used: number;
  resetInterval: "none" | "daily" | "monthly";
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  agentVersionId: string;
  modelId: string;
  providerId: string;
  status:
    | "queued"
    | "running"
    | "waiting_tool_approval"
    | "cancelled"
    | "completed"
    | "failed";
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface QueuedChatTurn {
  id: string;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  modelId?: string;
  content: string;
  webSearch?: boolean;
  agenticRag?: boolean;
  urls?: string[];
  createdBy: string;
  principalId: string;
  principalType: "user" | "service_account";
  scopeSnapshot: Scope[];
  idempotencyKey: string;
  status: "queued" | "leased" | "failed" | "cancelled" | "completed";
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type { BaseModel, ProviderInstance };
export type {
  DataConnector,
  DataConnectorStatus,
  DataConnectorSync,
  DataConnectorSyncStatus,
  DataConnectorType,
  LocalImportSyncItem,
} from "./data-connectors";
export type { DeviceAuthorization } from "./device-authorizations";
export type {
  EvalCase,
  EvalDashboard,
  EvalDashboardRunPoint,
  EvalDashboardSuiteSummary,
  EvalReleaseCandidateEvidence,
  EvalReleaseCandidateSuiteEvidence,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  EvalToolCallExpectation,
  EvalToolOutcomeExpectation,
} from "./evals";
export type {
  ChatComment,
  FavoritableResourceType,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  NotificationDeliveryStatus,
  NotificationType,
  PromptTemplate,
  PromptTemplateVisibility,
  ResourceFavorite,
  UserNotification,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "./collaboration";
export type {
  AgentKnowledgeBinding,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
  KnowledgeSource,
} from "./knowledge";
export type {
  AccessReviewConnectorOwnership,
  AccessReviewDataConnectorPosture,
  AccessReviewDelegatedOAuthConnectionPosture,
  AccessReviewGroupPosture,
  AccessReviewPolicyPosture,
  AccessReviewReport,
  AccessReviewServiceAccountPosture,
  AccessReviewSummary,
  AccessReviewSupportAccessPosture,
  AccessReviewSupportRequestPosture,
  AccessReviewSupportSessionPosture,
  AccessReviewToolConnectorPosture,
  AccessReviewToolRiskPosture,
  AccessReviewUserPosture,
  AccessReviewWorkerJobPosture,
  ComplianceControl,
  ComplianceControlEvidence,
  ComplianceControlStatus,
  ComplianceReport,
  DataDeletionCounts,
  DataDeletionPlan,
  DataDeletionPreview,
  DataDeletionResourceType,
  DataDeletionResult,
  DataExportCounts,
  DataExportPackageDeleteResult,
  DataExportDocument,
  DataExportLimits,
  DataExportPackage,
  DataExportPackageArtifact,
  DataExportPackageList,
  DataExportPackageSummary,
  DataExportPreview,
  DataExportRequest,
  DataExportResolvedRequest,
  DataExportScope,
  DataRightsCoverageReport,
  DataRightsCoverageStatus,
  DataRightsRetentionEvidenceControl,
  DataRightsRetentionEvidenceInvalidReason,
  DataRightsRetentionEvidenceStatus,
  DataRightsRetentionEvidenceSummary,
  DataRightsStorageClassCoverage,
  DataRightsWorkflowCoverage,
  ExportedObjectBytes,
  IdentityLifecyclePolicy,
  RetentionEnforcementResult,
  RetentionPolicy,
} from "./governance";
export type {
  AgentToolBinding,
  ToolCallRecord,
  ToolConnector,
  ToolConnectorAuthCheck,
  ToolNetworkPolicy,
  ToolOperation,
  ToolOperationDispatchPayload,
  ToolOperationDispatchPayloadAuth,
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestExpiryReason,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestExpiryResult,
  ToolOperationDispatchRequestResult,
  ToolOperationDispatchRequestReadbackResult,
  ToolOperationDispatchResult,
  ToolOperationDispatchTransport,
  ToolOperationTestDisabledReason,
  ToolOperationTestPreview,
} from "./tools";
export type { SsoOidcSettings } from "./sso";
export type {
  WebhookDelivery,
  WebhookEventType,
  WebhookSubscription,
} from "./webhooks";
export type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSchedule,
  WorkflowScheduleRunResult,
  WorkflowStep,
  WorkflowStepRecoveryPolicy,
  WorkflowStepRetryPolicy,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowStepType,
  WorkflowTemplate,
} from "./workflows";
