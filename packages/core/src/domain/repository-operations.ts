import type { PrincipalType, ResourceGrant } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type {
  AuditLog,
  AuditExportAttempt,
  AuditExportDestination,
  AuditExportIdempotencyReceipt,
  AuditExportJob,
  AuditIntegrityCheckpoint,
  AuditIntegrityRecord,
  AuditRetentionExportGate,
  AuthorizedWorkspaceFoldersByIdsInput,
  AuthorizedWorkspaceFolderItemsBatchInput,
  BackgroundJob,
  BillingEventReceipt,
  BillingPlan,
  DataDeletionPlan,
  DataDeletionResourceType,
  PromptTemplate,
  QuotaBucket,
  ResourceFavorite,
  RetentionPolicy,
  RunRecord,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  UsageEvent,
  WebhookDelivery,
  WebhookSubscription,
  WorkspaceFolder,
  WorkspaceFolderItem,
  WorkspaceFolderItemsBatchGroup,
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
} from "./entities";
import type {
  AuthorizedPromptCatalogQuery,
  ClaimDueWebhookDeliveriesInput,
  ClaimBackgroundJobInput,
  ClaimedWebhookDelivery,
  ClaimWebhookDeliveryInput,
  CompleteWebhookDeliveryAttemptInput,
  FinalizeRunInput,
  ListBackgroundJobsInput,
  ListWebhookDeliveriesPageInput,
  RenewBackgroundJobLeaseInput,
  UpdateBackgroundJobWithLeaseInput,
} from "./repository";
import type { AuditLogQueryResult, QueryAuditLogsInput } from "./audit-query";
import type {
  RuntimeKeyUsageCounts,
  RuntimeKeyUsageQuery,
} from "./runtime-key-usage";
import type {
  DeleteServerTableSavedViewResult,
  ListServerTableSavedViewsInput,
  RestoreServerTableSavedViewResult,
  ServerTableSavedViewRecord,
  WriteServerTableSavedViewResult,
} from "./server-table-records";
import type {
  QueryInventoriedTableRowsInput,
  QueryInventoriedTableRowsResult,
} from "./inventoried-table-repository";
import type {
  ContentPolicyDecisionRecord,
  PolicyApprovalRecord,
  TransitionPolicyApprovalInput,
} from "./content-policy";
import type {
  ClaimGovernanceExportJobInput,
  UpdateGovernanceExportJobWithLeaseInput,
} from "./governance-export-records";
import type {
  ClaimContentDeletionInput,
  ContentDeletionOperation,
  UpdateContentDeletionWithLeaseInput,
  RenewContentDeletionLeaseInput,
} from "./content-deletion";

export interface RepositoryOperationsCapability {
  createContentDeletionOperation(
    operation: ContentDeletionOperation,
  ): Promise<ContentDeletionOperation>;
  getContentDeletionOperation(
    orgId: string,
    operationId: string,
  ): Promise<ContentDeletionOperation | undefined>;
  getActiveContentDeletionOperation(
    orgId: string,
    targetType: ContentDeletionOperation["targetType"],
    targetId: string,
  ): Promise<ContentDeletionOperation | undefined>;
  claimContentDeletionOperation(
    input: ClaimContentDeletionInput,
  ): Promise<ContentDeletionOperation | undefined>;
  updateContentDeletionOperationWithLease(
    input: UpdateContentDeletionWithLeaseInput,
  ): Promise<ContentDeletionOperation | undefined>;
  renewContentDeletionOperationLease(
    input: RenewContentDeletionLeaseInput,
  ): Promise<ContentDeletionOperation | undefined>;
  createGovernanceExportJob(
    job: GovernanceExportJobRecord,
  ): Promise<GovernanceExportJobRecord>;
  getGovernanceExportJob(
    orgId: string,
    jobId: string,
  ): Promise<GovernanceExportJobRecord | undefined>;
  listGovernanceExportJobs(
    orgId: string,
    limit: number,
  ): Promise<GovernanceExportJobRecord[]>;
  claimGovernanceExportJob(
    input: ClaimGovernanceExportJobInput,
  ): Promise<GovernanceExportJobRecord | undefined>;
  updateGovernanceExportJobWithLease(
    input: UpdateGovernanceExportJobWithLeaseInput,
  ): Promise<GovernanceExportJobRecord | undefined>;
  updateGovernanceExportJob(
    job: GovernanceExportJobRecord,
  ): Promise<GovernanceExportJobRecord | undefined>;
  createGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ): Promise<GovernanceExportArtifactRecord>;
  getGovernanceExportArtifact(
    orgId: string,
    jobId: string,
  ): Promise<GovernanceExportArtifactRecord | undefined>;
  updateGovernanceExportArtifact(
    artifact: GovernanceExportArtifactRecord,
  ): Promise<GovernanceExportArtifactRecord | undefined>;
  listContentPolicyDecisions(
    orgId: string,
    limit: number,
  ): Promise<ContentPolicyDecisionRecord[]>;
  getContentPolicyDecision(
    orgId: string,
    decisionId: string,
  ): Promise<ContentPolicyDecisionRecord | undefined>;
  createContentPolicyDecision(
    decision: ContentPolicyDecisionRecord,
  ): Promise<ContentPolicyDecisionRecord>;
  listContentPolicyApprovals(
    orgId: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]>;
  listPendingContentPolicyApprovalsDue(
    orgId: string,
    asOf: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]>;
  getContentPolicyApproval(
    orgId: string,
    approvalId: string,
  ): Promise<PolicyApprovalRecord | undefined>;
  createContentPolicyApproval(
    approval: PolicyApprovalRecord,
  ): Promise<PolicyApprovalRecord>;
  transitionContentPolicyApproval(
    input: TransitionPolicyApprovalInput,
  ): Promise<PolicyApprovalRecord | undefined>;
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  listRuns(chatId: string): Promise<RunRecord[]>;
  updateRun(run: RunRecord): Promise<RunRecord>;
  finalizeRun(input: FinalizeRunInput): Promise<RunRecord | undefined>;
  allocateRunEventSequence(runId: string): Promise<number | undefined>;
  appendRunEvents(events: RunEvent[]): Promise<void>;
  listRunEventsAfter(
    runId: string,
    afterSequence: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RunEvent[]>;
  listRunEvents(runId: string): Promise<RunEvent[]>;
  deleteCompactedRunEventsBefore(
    orgId: string,
    before: string,
    now: string,
    limit: number,
  ): Promise<number>;
  listToolCalls(orgId: string): Promise<ToolCallRecord[]>;
  listToolCallsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<ToolCallRecord[]>;
  createToolCall(call: ToolCallRecord): Promise<ToolCallRecord>;
  listToolConnectors(orgId: string): Promise<ToolConnector[]>;
  createToolConnector(connector: ToolConnector): Promise<ToolConnector>;
  updateToolConnector(connector: ToolConnector): Promise<ToolConnector>;
  listToolOperations(connectorId: string): Promise<ToolOperation[]>;
  listToolOperationsForConnectors(
    connectorIds: string[],
  ): Promise<ToolOperation[]>;
  createToolOperations(operations: ToolOperation[]): Promise<ToolOperation[]>;
  updateToolOperation(operation: ToolOperation): Promise<ToolOperation>;
  listAuditLogs(orgId: string): Promise<AuditLog[]>;
  queryAuditLogs(input: QueryAuditLogsInput): Promise<AuditLogQueryResult>;
  createAuditLog(log: AuditLog): Promise<AuditLog>;
  deleteAuditLogsBefore(orgId: string, before: string): Promise<number>;
  listAuditIntegrityRecords(orgId: string): Promise<AuditIntegrityRecord[]>;
  ensureAuditIntegrityRecords(orgId: string): Promise<number>;
  listAuditIntegrityCheckpoints(
    orgId: string,
  ): Promise<AuditIntegrityCheckpoint[]>;
  getAuditIntegrityCheckpoint(
    orgId: string,
    checkpointId: string,
  ): Promise<AuditIntegrityCheckpoint | undefined>;
  getAuditIntegrityCheckpointByHash(
    orgId: string,
    checkpointHash: string,
  ): Promise<AuditIntegrityCheckpoint | undefined>;
  createAuditIntegrityCheckpoint(
    checkpoint: AuditIntegrityCheckpoint,
  ): Promise<AuditIntegrityCheckpoint>;
  getAuditExportDestination(
    orgId: string,
    kind: AuditExportDestination["kind"],
  ): Promise<AuditExportDestination | undefined>;
  upsertAuditExportDestination(
    destination: AuditExportDestination,
  ): Promise<AuditExportDestination>;
  getAuditExportJob(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportJob | undefined>;
  listAuditExportJobs(
    orgId: string,
    destinationId?: string,
  ): Promise<AuditExportJob[]>;
  getAuditExportJobByIdempotencyHash(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportJob | undefined>;
  createAuditExportJob(job: AuditExportJob): Promise<AuditExportJob>;
  claimAuditExportJob(input: {
    jobId: string;
    leaseSeconds: number;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<AuditExportJob | undefined>;
  completeAuditExportAttempt(input: {
    attempt: AuditExportAttempt;
    job: AuditExportJob;
    leaseToken: string;
  }): Promise<AuditExportJob | undefined>;
  listAuditExportAttempts(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportAttempt[]>;
  getAuditExportIdempotencyReceipt(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportIdempotencyReceipt | undefined>;
  createAuditExportIdempotencyReceipt(
    receipt: AuditExportIdempotencyReceipt,
  ): Promise<AuditExportIdempotencyReceipt>;
  auditRetentionExportGate(
    orgId: string,
    before: string,
  ): Promise<AuditRetentionExportGate>;
  getDataDeletionPlan(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
    evaluatedAt?: string,
  ): Promise<DataDeletionPlan | undefined>;
  deleteDataForResource(
    orgId: string,
    resourceType: DataDeletionResourceType,
    resourceId: string,
    evaluatedAt?: string,
  ): Promise<DataDeletionPlan | undefined>;
  listUsageEvents(orgId: string): Promise<UsageEvent[]>;
  listUsageEventsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<UsageEvent[]>;
  createUsageEvent(event: UsageEvent): Promise<UsageEvent>;
  updateUsageEvent(event: UsageEvent): Promise<UsageEvent>;
  getBackgroundJob(
    orgId: string,
    jobId: string,
  ): Promise<BackgroundJob | undefined>;
  listBackgroundJobs(
    orgId: string,
    input?: ListBackgroundJobsInput,
  ): Promise<BackgroundJob[]>;
  queryInventoriedTableRows(
    input: QueryInventoriedTableRowsInput,
  ): Promise<QueryInventoriedTableRowsResult>;
  createBackgroundJob(job: BackgroundJob): Promise<BackgroundJob>;
  claimBackgroundJob(
    input: ClaimBackgroundJobInput,
  ): Promise<BackgroundJob | undefined>;
  renewBackgroundJobLease(
    input: RenewBackgroundJobLeaseInput,
  ): Promise<BackgroundJob | undefined>;
  updateBackgroundJobWithLease(
    input: UpdateBackgroundJobWithLeaseInput,
  ): Promise<BackgroundJob | undefined>;
  updateBackgroundJob(job: BackgroundJob): Promise<BackgroundJob>;
  listServerTableSavedViews(
    input: ListServerTableSavedViewsInput,
  ): Promise<ServerTableSavedViewRecord[]>;
  getServerTableSavedView(
    orgId: string,
    viewId: string,
  ): Promise<ServerTableSavedViewRecord | undefined>;
  writeServerTableSavedView(input: {
    view: ServerTableSavedViewRecord;
    expectedVersion?: number;
  }): Promise<WriteServerTableSavedViewResult>;
  deleteServerTableSavedView(input: {
    orgId: string;
    viewId: string;
    ownerUserId: string;
    expectedVersion?: number;
    deletedAt: string;
    deleteTokenHash: string;
    deleteTokenExpiresAt: string;
  }): Promise<DeleteServerTableSavedViewResult>;
  restoreServerTableSavedView(input: {
    orgId: string;
    viewId: string;
    ownerUserId: string;
    deleteTokenHash: string;
    expectedVersion?: number;
    restoredAt: string;
  }): Promise<RestoreServerTableSavedViewResult>;
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
  listWebhookDeliveriesPage(
    input: ListWebhookDeliveriesPageInput,
  ): Promise<WebhookDelivery[]>;
  countWebhookSigningKeyUsage(
    input: RuntimeKeyUsageQuery,
  ): Promise<RuntimeKeyUsageCounts>;
  claimWebhookDelivery(
    input: ClaimWebhookDeliveryInput,
  ): Promise<ClaimedWebhookDelivery | undefined>;
  claimDueWebhookDeliveries(
    input: ClaimDueWebhookDeliveriesInput,
  ): Promise<ClaimedWebhookDelivery[]>;
  completeWebhookDeliveryAttempt(
    input: CompleteWebhookDeliveryAttemptInput,
  ): Promise<WebhookDelivery | undefined>;
  createWebhookDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  updateWebhookDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  getRetentionPolicy(orgId: string): Promise<RetentionPolicy | undefined>;
  upsertRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy>;
  listQuotaBuckets(orgId: string): Promise<QuotaBucket[]>;
  createQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket>;
  updateQuotaBucket(bucket: QuotaBucket): Promise<QuotaBucket>;
  deleteQuotaBucket(quotaBucketId: string): Promise<QuotaBucket | undefined>;
  getBillingPlan(orgId: string): Promise<BillingPlan | undefined>;
  getBillingPlanByExternalCustomerId(
    externalCustomerId: string,
  ): Promise<BillingPlan | undefined>;
  acquireBillingSyncLock(orgId: string): Promise<void>;
  getBillingEventReceipt(
    orgId: string,
    provider: string,
    eventId: string,
  ): Promise<BillingEventReceipt | undefined>;
  createBillingEventReceipt(
    receipt: BillingEventReceipt,
  ): Promise<BillingEventReceipt>;
  upsertBillingPlan(plan: BillingPlan): Promise<BillingPlan>;
  listResourceGrants(orgId: string): Promise<ResourceGrant[]>;
  createResourceGrant(grant: ResourceGrant): Promise<ResourceGrant>;
  deleteResourceGrant(grantId: string): Promise<ResourceGrant | undefined>;
  deleteResourceGrantsForPrincipal(
    orgId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<ResourceGrant[]>;
  listPromptTemplates(
    orgId: string,
    workspaceId?: string,
  ): Promise<PromptTemplate[]>;
  listAuthorizedPromptTemplatesPage(
    input: AuthorizedPromptCatalogQuery,
  ): Promise<{ items: PromptTemplate[]; total: number }>;
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
  listAuthorizedWorkspaceFoldersByIds(
    input: AuthorizedWorkspaceFoldersByIdsInput,
  ): Promise<WorkspaceFolder[]>;
  getWorkspaceFolder(folderId: string): Promise<WorkspaceFolder | undefined>;
  createWorkspaceFolder(folder: WorkspaceFolder): Promise<WorkspaceFolder>;
  updateWorkspaceFolder(folder: WorkspaceFolder): Promise<WorkspaceFolder>;
  deleteWorkspaceFolder(folderId: string): Promise<WorkspaceFolder | undefined>;
  listWorkspaceFolderItems(folderId: string): Promise<WorkspaceFolderItem[]>;
  listAuthorizedWorkspaceFolderItemsBatch(
    input: AuthorizedWorkspaceFolderItemsBatchInput,
  ): Promise<WorkspaceFolderItemsBatchGroup[]>;
  createWorkspaceFolderItem(
    item: WorkspaceFolderItem,
  ): Promise<WorkspaceFolderItem>;
  deleteWorkspaceFolderItem(
    itemId: string,
  ): Promise<WorkspaceFolderItem | undefined>;
}
