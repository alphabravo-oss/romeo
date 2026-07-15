import type { BaseModel, ProviderInstance } from "@romeo/providers";
import type { Scope, UserRole } from "@romeo/auth";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface SystemSetting {
  key: string;
  value: Record<string, unknown>;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  archivedAt?: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role?: UserRole;
  disabledAt?: string;
}

export interface Group {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  userId: string;
  orgId: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  orgId: string;
  userId?: string;
  serviceAccountId?: string;
  name: string;
  hashedToken: string;
  scopes: Scope[];
  revokedAt?: string;
  createdAt: string;
}

export interface ServiceAccount {
  id: string;
  orgId: string;
  name: string;
  scopes: Scope[];
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

export interface UserSession {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  hashedToken: string;
  scopes: Scope[];
  isAdmin: boolean;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface LocalPasswordCredential {
  id: string;
  orgId: string;
  userId: string;
  emailNormalized: string;
  passwordHash: string;
  failedAttemptCount: number;
  lockedUntil?: string;
  passwordUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMfaFactor {
  id: string;
  orgId: string;
  userId: string;
  type: "recovery_codes" | "totp";
  name: string;
  status: "pending" | "active" | "disabled";
  secretEncrypted: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
}

export interface AgentParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface AgentSafetySettings {
  maxUserInputLength?: number;
  blockedTerms?: string[];
  promptInjectionGuard?: AgentPromptInjectionGuard;
}

export interface AgentPromptInjectionGuard {
  mode: "block";
  scanUserInput: boolean;
  scanRetrievedContext: boolean;
}

export interface AgentMemoryPolicy {
  mode: "disabled" | "recent_messages";
  maxMessages?: number;
}

export interface Agent {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParameters;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  publishedVersionId?: string;
  updatedAt: string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  orgId: string;
  workspaceId: string;
  version: number;
  status: "published";
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParameters;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
  evalSummary?: AgentVersionEvalSummary;
}

export interface AgentVersionEvalSuiteSummary {
  suiteId: string;
  runId: string | null;
  status: "failed" | "missing" | "passed";
  score: number | null;
  completedAt: string | null;
}

export interface AgentVersionEvalSummary {
  status: "failed" | "missing" | "not_required" | "passed";
  suiteCount: number;
  passedSuiteCount: number;
  failedSuiteCount: number;
  missingSuiteCount: number;
  averageScore: number | null;
  evaluatedAt: string | null;
  suites: AgentVersionEvalSuiteSummary[];
}

export interface Chat {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
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

export interface Message {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image";
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
  sourceType: "chat" | "run" | "tool" | "storage" | "voice";
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

export type QuotaMetric = "run.started" | "tool.call" | "storage.byte";

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
  EvalModelComparison,
  EvalModelComparisonItem,
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
