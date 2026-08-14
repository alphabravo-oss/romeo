import type {
  BaseModel,
  ProviderInstance,
  ProviderReasoningPolicy,
} from "@romeo/providers";
import type { MessagePartOutput as TypedMessagePart } from "@romeo/contracts";
import type { Scope } from "@romeo/auth";

export type * from "./agent-entities";
export type * from "./capabilities";
export type * from "./identity-entities";
export type * from "./operational-entities";

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
  /** Decimal monotonic version of message/parent/active-leaf structure. */
  transcriptVersion?: string;
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
  /** Ordered versioned parts; absent only on internal reads before compatibility projection. */
  parts?: TypedMessagePart[];
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

export interface LegacyMessagePart {
  id: string;
  messageId: string;
  type: "attachment" | "collaboration_channel_metadata";
  content: string;
  metadata: Record<string, unknown>;
}

export type MessagePart = LegacyMessagePart | TypedMessagePart;

/** Internal durable edge; never serialized as message content or public metadata. */
export interface MessageFileReference {
  messagePartId: string;
  messageId: string;
  fileId: string;
  orgId: string;
  workspaceId: string;
  createdAt: string;
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

export type FileObjectStatus =
  | "attached"
  | "available"
  | "deleted"
  | "extracting"
  | "failed"
  | "quarantined"
  | "ready"
  | "retained"
  | "scanning"
  | "transcoding"
  | "uploading";

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
  lifecycleVersion?: number;
  lifecycleAttempts?: number;
  lifecycleFailureCode?: string;
  lifecycleNextAttemptAt?: string;
  lifecycleLeaseOwner?: string;
  lifecycleLeaseToken?: string;
  lifecycleLeaseExpiresAt?: string;
  attachedAt?: string;
  retainedAt?: string;
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
  routingMode?: "economy";
  researchMode?: "deep";
  reasoningPolicy?: ProviderReasoningPolicy;
  parentMessageId?: string | null;
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
  EvalReasoningComparison,
  EvalReasoningPolicyEvidence,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunMetrics,
  EvalRunResult,
  EvalSuite,
  EvalToolCallExpectation,
  EvalToolOutcomeExpectation,
} from "./evals";
export type {
  AuthorizedWorkspaceFoldersByIdsInput,
  AuthorizedWorkspaceFolderItemsBatchInput,
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
  WorkspaceFolderItemsBatchGroup,
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
