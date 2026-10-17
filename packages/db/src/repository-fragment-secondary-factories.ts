import type { RomeoDatabase } from "./client";
export { createContentPolicyRepositoryFragment } from "./content-policy-repository-fragment-factory";
import { PgAccessRepository } from "./access-repository";
import { PgCapabilityAssignmentRepository } from "./capability-assignment-repository";
import { PgCapabilityFlagRepository } from "./capability-flag-repository";
import { PgIdempotencyRepository } from "./idempotency-repository";
import { PgInventoriedTablePageRepository } from "./inventoried-table-page-repository";
import { PgCollaborationChannelRepository } from "./collaboration-channel-repository";
import { PgCollaborationRepository } from "./collaboration-repository";
import { PgDataDeletionRepository } from "./data-deletion-repository";
import { PgFileRepository } from "./file-repository";
import { PgGovernanceBillingRepository } from "./governance-billing-repository";
import { PgGovernanceExportRepository } from "./governance-export-repository";
import { PgNotificationRepository } from "./notification-repository";
import { PgOperationalRepository } from "./operational-repository";
import { PgRunRepository } from "./run-repository";
import { PgServerTableRepository } from "./server-table-repository";
import { PgToolConnectorRepository } from "./tool-connector-repository";
import { PgVoiceRepository } from "./voice-repository";
import { PgWebhookRepository } from "./webhook-repository";
import type {
  AccessRepositoryFragment,
  CapabilityAssignmentRepositoryFragment,
  CapabilityFlagRepositoryFragment,
  IdempotencyRepositoryFragment,
  InventoriedTablePageRepositoryFragment,
  CollaborationChannelRepositoryFragment,
  CollaborationRepositoryFragment,
  DataDeletionRepositoryFragment,
  FileRepositoryFragment,
  GovernanceBillingRepositoryFragment,
  GovernanceExportRepositoryFragment,
  NotificationRepositoryFragment,
  OperationalRepositoryFragment,
  RunRepositoryFragment,
  ServerTableRepositoryFragment,
  ToolConnectorRepositoryFragment,
  VoiceRepositoryFragment,
  WebhookRepositoryFragment,
} from "./repository-fragment-types";

export function createGovernanceExportRepositoryFragment(
  db: RomeoDatabase,
): GovernanceExportRepositoryFragment {
  const repository = new PgGovernanceExportRepository(db);
  return {
    claimGovernanceExportJob:
      repository.claimGovernanceExportJob.bind(repository),
    createGovernanceExportArtifact:
      repository.createGovernanceExportArtifact.bind(repository),
    createGovernanceExportJob:
      repository.createGovernanceExportJob.bind(repository),
    getGovernanceExportArtifact:
      repository.getGovernanceExportArtifact.bind(repository),
    getGovernanceExportJob: repository.getGovernanceExportJob.bind(repository),
    listGovernanceExportJobs:
      repository.listGovernanceExportJobs.bind(repository),
    updateGovernanceExportArtifact:
      repository.updateGovernanceExportArtifact.bind(repository),
    updateGovernanceExportJob:
      repository.updateGovernanceExportJob.bind(repository),
    updateGovernanceExportJobWithLease:
      repository.updateGovernanceExportJobWithLease.bind(repository),
  };
}

export function createInventoriedTablePageRepositoryFragment(
  db: RomeoDatabase,
): InventoriedTablePageRepositoryFragment {
  const repository = new PgInventoriedTablePageRepository(db);
  return {
    queryInventoriedTableRows:
      repository.queryInventoriedTableRows.bind(repository),
  };
}

export function createServerTableRepositoryFragment(
  db: RomeoDatabase,
): ServerTableRepositoryFragment {
  const repository = new PgServerTableRepository(db);
  return {
    deleteServerTableSavedView:
      repository.deleteServerTableSavedView.bind(repository),
    getServerTableSavedView:
      repository.getServerTableSavedView.bind(repository),
    listServerTableSavedViews:
      repository.listServerTableSavedViews.bind(repository),
    restoreServerTableSavedView:
      repository.restoreServerTableSavedView.bind(repository),
    writeServerTableSavedView:
      repository.writeServerTableSavedView.bind(repository),
  };
}

export function createFileRepositoryFragment(
  db: RomeoDatabase,
): FileRepositoryFragment {
  const repository = new PgFileRepository(db);
  return {
    advanceFileLifecycleLease:
      repository.advanceFileLifecycleLease.bind(repository),
    claimNextFileLifecycle: repository.claimNextFileLifecycle.bind(repository),
    createFileObject: repository.createFileObject.bind(repository),
    finishFileLifecycleLease:
      repository.finishFileLifecycleLease.bind(repository),
    getFileObject: repository.getFileObject.bind(repository),
    getFileLifecycleQueueSummary:
      repository.getFileLifecycleQueueSummary.bind(repository),
    listFileObjects: repository.listFileObjects.bind(repository),
    listFileRetentionCandidates:
      repository.listFileRetentionCandidates.bind(repository),
    listAuthorizedFileObjectsPage:
      repository.listAuthorizedFileObjectsPage.bind(repository),
    renewFileLifecycleLease:
      repository.renewFileLifecycleLease.bind(repository),
    updateFileObject: repository.updateFileObject.bind(repository),
  };
}

export function createCollaborationChannelRepositoryFragment(
  db: RomeoDatabase,
): CollaborationChannelRepositoryFragment {
  const repository = new PgCollaborationChannelRepository(db);
  return {
    createCollaborationChannel:
      repository.createCollaborationChannel.bind(repository),
    createCollaborationChannelMember:
      repository.createCollaborationChannelMember.bind(repository),
    deleteCollaborationChannel:
      repository.deleteCollaborationChannel.bind(repository),
    deleteCollaborationChannelMembers:
      repository.deleteCollaborationChannelMembers.bind(repository),
    getCollaborationChannel:
      repository.getCollaborationChannel.bind(repository),
    getCollaborationChannelMember:
      repository.getCollaborationChannelMember.bind(repository),
    listCollaborationChannelMembers:
      repository.listCollaborationChannelMembers.bind(repository),
    listCollaborationChannels:
      repository.listCollaborationChannels.bind(repository),
    updateCollaborationChannel:
      repository.updateCollaborationChannel.bind(repository),
    updateCollaborationChannelMember:
      repository.updateCollaborationChannelMember.bind(repository),
  };
}

export function createRunRepositoryFragment(
  db: RomeoDatabase,
): RunRepositoryFragment {
  const repository = new PgRunRepository(db);
  return {
    allocateRunEventSequence:
      repository.allocateRunEventSequence.bind(repository),
    appendRunEvents: repository.appendRunEvents.bind(repository),
    createRun: repository.createRun.bind(repository),
    createToolCall: repository.createToolCall.bind(repository),
    deleteCompactedRunEventsBefore:
      repository.deleteCompactedRunEventsBefore.bind(repository),
    finalizeRun: repository.finalizeRun.bind(repository),
    getRun: repository.getRun.bind(repository),
    listRuns: repository.listRuns.bind(repository),
    listRunEventsAfter: repository.listRunEventsAfter.bind(repository),
    listRunEvents: repository.listRunEvents.bind(repository),
    listToolCalls: repository.listToolCalls.bind(repository),
    listToolCallsForRun: repository.listToolCallsForRun.bind(repository),
    updateRun: repository.updateRun.bind(repository),
  };
}

export function createToolConnectorRepositoryFragment(
  db: RomeoDatabase,
): ToolConnectorRepositoryFragment {
  const repository = new PgToolConnectorRepository(db);
  return {
    createToolConnector: repository.createToolConnector.bind(repository),
    createToolOperations: repository.createToolOperations.bind(repository),
    listToolConnectors: repository.listToolConnectors.bind(repository),
    listToolOperations: repository.listToolOperations.bind(repository),
    listToolOperationsForConnectors:
      repository.listToolOperationsForConnectors.bind(repository),
    updateToolConnector: repository.updateToolConnector.bind(repository),
    updateToolOperation: repository.updateToolOperation.bind(repository),
  };
}

export function createOperationalRepositoryFragment(
  db: RomeoDatabase,
): OperationalRepositoryFragment {
  const repository = new PgOperationalRepository(db);
  return {
    auditRetentionExportGate:
      repository.auditRetentionExportGate.bind(repository),
    claimAuditExportJob: repository.claimAuditExportJob.bind(repository),
    completeAuditExportAttempt:
      repository.completeAuditExportAttempt.bind(repository),
    ensureAuditIntegrityRecords:
      repository.ensureAuditIntegrityRecords.bind(repository),
    claimBackgroundJob: repository.claimBackgroundJob.bind(repository),
    createAuditExportIdempotencyReceipt:
      repository.createAuditExportIdempotencyReceipt.bind(repository),
    createAuditExportJob: repository.createAuditExportJob.bind(repository),
    createAuditIntegrityCheckpoint:
      repository.createAuditIntegrityCheckpoint.bind(repository),
    createAuditLog: repository.createAuditLog.bind(repository),
    createBackgroundJob: repository.createBackgroundJob.bind(repository),
    createUsageEvent: repository.createUsageEvent.bind(repository),
    deleteAuditLogsBefore: repository.deleteAuditLogsBefore.bind(repository),
    getSystemSetting: repository.getSystemSetting.bind(repository),
    getAuditExportDestination:
      repository.getAuditExportDestination.bind(repository),
    getAuditExportIdempotencyReceipt:
      repository.getAuditExportIdempotencyReceipt.bind(repository),
    getAuditExportJob: repository.getAuditExportJob.bind(repository),
    getAuditExportJobByIdempotencyHash:
      repository.getAuditExportJobByIdempotencyHash.bind(repository),
    getAuditIntegrityCheckpoint:
      repository.getAuditIntegrityCheckpoint.bind(repository),
    getAuditIntegrityCheckpointByHash:
      repository.getAuditIntegrityCheckpointByHash.bind(repository),
    listAuditExportAttempts:
      repository.listAuditExportAttempts.bind(repository),
    listAuditExportJobs: repository.listAuditExportJobs.bind(repository),
    listAuditIntegrityCheckpoints:
      repository.listAuditIntegrityCheckpoints.bind(repository),
    listAuditIntegrityRecords:
      repository.listAuditIntegrityRecords.bind(repository),
    listAuditLogs: repository.listAuditLogs.bind(repository),
    queryAuditLogs: repository.queryAuditLogs.bind(repository),
    getBackgroundJob: repository.getBackgroundJob.bind(repository),
    listBackgroundJobs: repository.listBackgroundJobs.bind(repository),
    listSystemSettings: repository.listSystemSettings.bind(repository),
    listUsageEvents: repository.listUsageEvents.bind(repository),
    listUsageEventsForRun: repository.listUsageEventsForRun.bind(repository),
    renewBackgroundJobLease:
      repository.renewBackgroundJobLease.bind(repository),
    updateBackgroundJobWithLease:
      repository.updateBackgroundJobWithLease.bind(repository),
    upsertSystemSetting: repository.upsertSystemSetting.bind(repository),
    upsertAuditExportDestination:
      repository.upsertAuditExportDestination.bind(repository),
    updateBackgroundJob: repository.updateBackgroundJob.bind(repository),
    updateUsageEvent: repository.updateUsageEvent.bind(repository),
  };
}

export function createWebhookRepositoryFragment(
  db: RomeoDatabase,
): WebhookRepositoryFragment {
  const repository = new PgWebhookRepository(db);
  return {
    claimDueWebhookDeliveries:
      repository.claimDueWebhookDeliveries.bind(repository),
    claimWebhookDelivery: repository.claimWebhookDelivery.bind(repository),
    completeWebhookDeliveryAttempt:
      repository.completeWebhookDeliveryAttempt.bind(repository),
    countWebhookSigningKeyUsage:
      repository.countWebhookSigningKeyUsage.bind(repository),
    createWebhookDelivery: repository.createWebhookDelivery.bind(repository),
    createWebhookSubscription:
      repository.createWebhookSubscription.bind(repository),
    getWebhookSubscription: repository.getWebhookSubscription.bind(repository),
    listWebhookDeliveries: repository.listWebhookDeliveries.bind(repository),
    listWebhookDeliveriesPage:
      repository.listWebhookDeliveriesPage.bind(repository),
    listWebhookSubscriptions:
      repository.listWebhookSubscriptions.bind(repository),
    updateWebhookDelivery: repository.updateWebhookDelivery.bind(repository),
    updateWebhookSubscription:
      repository.updateWebhookSubscription.bind(repository),
  };
}

export function createGovernanceBillingRepositoryFragment(
  db: RomeoDatabase,
): GovernanceBillingRepositoryFragment {
  const repository = new PgGovernanceBillingRepository(db);
  return {
    acquireBillingSyncLock: repository.acquireBillingSyncLock.bind(repository),
    createBillingEventReceipt:
      repository.createBillingEventReceipt.bind(repository),
    createQuotaBucket: repository.createQuotaBucket.bind(repository),
    deleteQuotaBucket: repository.deleteQuotaBucket.bind(repository),
    getBillingPlan: repository.getBillingPlan.bind(repository),
    getBillingPlanByExternalCustomerId:
      repository.getBillingPlanByExternalCustomerId.bind(repository),
    getBillingEventReceipt: repository.getBillingEventReceipt.bind(repository),
    getRetentionPolicy: repository.getRetentionPolicy.bind(repository),
    listQuotaBuckets: repository.listQuotaBuckets.bind(repository),
    updateQuotaBucket: repository.updateQuotaBucket.bind(repository),
    upsertBillingPlan: repository.upsertBillingPlan.bind(repository),
    upsertRetentionPolicy: repository.upsertRetentionPolicy.bind(repository),
  };
}

export function createNotificationRepositoryFragment(
  db: RomeoDatabase,
): NotificationRepositoryFragment {
  const repository = new PgNotificationRepository(db);
  return {
    claimDueNotificationDeliveries:
      repository.claimDueNotificationDeliveries.bind(repository),
    createNotificationDelivery:
      repository.createNotificationDelivery.bind(repository),
    createNotificationDeliveryChannel:
      repository.createNotificationDeliveryChannel.bind(repository),
    createUserNotification: repository.createUserNotification.bind(repository),
    listNotificationDeliveries:
      repository.listNotificationDeliveries.bind(repository),
    listFailedNotificationDeliveries:
      repository.listFailedNotificationDeliveries.bind(repository),
    listNotificationDeliveryChannels:
      repository.listNotificationDeliveryChannels.bind(repository),
    finishNotificationDeliveryLease:
      repository.finishNotificationDeliveryLease.bind(repository),
    listUserNotifications: repository.listUserNotifications.bind(repository),
    updateNotificationDelivery:
      repository.updateNotificationDelivery.bind(repository),
    updateUserNotification: repository.updateUserNotification.bind(repository),
  };
}

export function createCollaborationRepositoryFragment(
  db: RomeoDatabase,
): CollaborationRepositoryFragment {
  const repository = new PgCollaborationRepository(db);
  return {
    createPromptTemplate: repository.createPromptTemplate.bind(repository),
    createResourceFavorite: repository.createResourceFavorite.bind(repository),
    createWorkspaceFolder: repository.createWorkspaceFolder.bind(repository),
    createWorkspaceFolderItem:
      repository.createWorkspaceFolderItem.bind(repository),
    deletePromptTemplate: repository.deletePromptTemplate.bind(repository),
    deleteResourceFavorite: repository.deleteResourceFavorite.bind(repository),
    deleteWorkspaceFolder: repository.deleteWorkspaceFolder.bind(repository),
    deleteWorkspaceFolderItem:
      repository.deleteWorkspaceFolderItem.bind(repository),
    getPromptTemplate: repository.getPromptTemplate.bind(repository),
    getWorkspaceFolder: repository.getWorkspaceFolder.bind(repository),
    listAuthorizedWorkspaceFoldersByIds:
      repository.listAuthorizedWorkspaceFoldersByIds.bind(repository),
    listPromptTemplates: repository.listPromptTemplates.bind(repository),
    listAuthorizedPromptTemplatesPage:
      repository.listAuthorizedPromptTemplatesPage.bind(repository),
    listResourceFavorites: repository.listResourceFavorites.bind(repository),
    listWorkspaceFolderItems:
      repository.listWorkspaceFolderItems.bind(repository),
    listAuthorizedWorkspaceFolderItemsBatch:
      repository.listAuthorizedWorkspaceFolderItemsBatch.bind(repository),
    listWorkspaceFolders: repository.listWorkspaceFolders.bind(repository),
    updatePromptTemplate: repository.updatePromptTemplate.bind(repository),
    updateWorkspaceFolder: repository.updateWorkspaceFolder.bind(repository),
  };
}

export function createAccessRepositoryFragment(
  db: RomeoDatabase,
): AccessRepositoryFragment {
  const repository = new PgAccessRepository(db);
  return {
    createResourceGrant: repository.createResourceGrant.bind(repository),
    deleteResourceGrant: repository.deleteResourceGrant.bind(repository),
    deleteResourceGrantsForPrincipal:
      repository.deleteResourceGrantsForPrincipal.bind(repository),
    listResourceGrants: repository.listResourceGrants.bind(repository),
    listResourceGrantsBySource:
      repository.listResourceGrantsBySource.bind(repository),
  };
}

export function createCapabilityAssignmentRepositoryFragment(
  db: RomeoDatabase,
): CapabilityAssignmentRepositoryFragment {
  const repository = new PgCapabilityAssignmentRepository(db);
  return {
    listActiveCapabilityAssignments:
      repository.listActiveCapabilityAssignments.bind(repository),
    listCapabilityAssignmentHistory:
      repository.listCapabilityAssignmentHistory.bind(repository),
    replaceCapabilityAssignment:
      repository.replaceCapabilityAssignment.bind(repository),
  };
}

export function createCapabilityFlagRepositoryFragment(
  db: RomeoDatabase,
): CapabilityFlagRepositoryFragment {
  const repository = new PgCapabilityFlagRepository(db);
  return {
    listActiveOrganizationCapabilityFlags:
      repository.listActiveOrganizationCapabilityFlags.bind(repository),
    listOrganizationCapabilityFlagHistory:
      repository.listOrganizationCapabilityFlagHistory.bind(repository),
    replaceOrganizationCapabilityFlag:
      repository.replaceOrganizationCapabilityFlag.bind(repository),
  };
}

export function createIdempotencyRepositoryFragment(
  db: RomeoDatabase,
): IdempotencyRepositoryFragment {
  const repository = new PgIdempotencyRepository(db);
  return {
    claimIdempotencyReceipt:
      repository.claimIdempotencyReceipt.bind(repository),
    completeIdempotencyReceipt:
      repository.completeIdempotencyReceipt.bind(repository),
    failIdempotencyReceipt: repository.failIdempotencyReceipt.bind(repository),
    deleteExpiredIdempotencyReceipts:
      repository.deleteExpiredIdempotencyReceipts.bind(repository),
  };
}

export function createVoiceRepositoryFragment(
  db: RomeoDatabase,
): VoiceRepositoryFragment {
  const repository = new PgVoiceRepository(db);
  return {
    createVoiceProfile: repository.createVoiceProfile.bind(repository),
    getVoiceProfile: repository.getVoiceProfile.bind(repository),
    listVoiceProfiles: repository.listVoiceProfiles.bind(repository),
  };
}

export function createDataDeletionRepositoryFragment(
  db: RomeoDatabase,
): DataDeletionRepositoryFragment {
  const repository = new PgDataDeletionRepository(db);
  return {
    deleteDataForResource: repository.deleteDataForResource.bind(repository),
    getDataDeletionPlan: repository.getDataDeletionPlan.bind(repository),
  };
}
