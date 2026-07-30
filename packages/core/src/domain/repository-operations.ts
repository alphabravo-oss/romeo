import type { PrincipalType, ResourceGrant } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type {
  AuditLog,
  BackgroundJob,
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
  WorkflowDefinition,
  WorkflowRun,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "./entities";
import type {
  AuthorizedPromptCatalogQuery,
  ClaimBackgroundJobInput,
  FinalizeRunInput,
  RenewBackgroundJobLeaseInput,
  UpdateBackgroundJobWithLeaseInput,
} from "./repository";

export interface RepositoryOperationsCapability {
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  listRuns(chatId: string): Promise<RunRecord[]>;
  updateRun(run: RunRecord): Promise<RunRecord>;
  finalizeRun(input: FinalizeRunInput): Promise<RunRecord | undefined>;
  appendRunEvents(events: RunEvent[]): Promise<void>;
  listRunEvents(runId: string): Promise<RunEvent[]>;
  listToolCalls(orgId: string): Promise<ToolCallRecord[]>;
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
  updateBackgroundJobWithLease(
    input: UpdateBackgroundJobWithLeaseInput,
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
