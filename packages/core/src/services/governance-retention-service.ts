import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  RetentionEnforcementResult,
  RetentionPolicy,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { iterateBackgroundJobs } from "./background-job-query";
import { enforceGovernedDataExportPackageRetention } from "./data-export-package";
import { enforceFileRetentionBatches } from "./file-retention-enforcement";
import {
  defaultRetentionPolicy,
  retentionPolicyForOrg,
  validateFileRetentionDays,
  withoutBrowserArtifacts,
} from "./governance-retention-policy";
import {
  browserAutomationJobType,
  readBrowserAutomationStoredArtifacts,
} from "./browser-automation-tasks";
import {
  readVoiceArtifactUsageMetadata,
  redactVoiceArtifactStorageMetadata,
} from "./voice-artifact-metadata";
import { updateRecordedUsage } from "./record-usage";
import type { CapabilityService } from "./capability-resolver";

export interface GovernanceServiceOptions {
  capabilities?: CapabilityService;
  scimEnabled?: boolean | undefined;
  deleteKnowledgeSource?: (input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }) => Promise<unknown>;
}

export class GovernanceRetentionService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly objectStore: ObjectStore,
    protected readonly options: GovernanceServiceOptions = {},
  ) {}

  async retentionPolicy(subject: AuthSubject): Promise<RetentionPolicy> {
    assertScope(subject, "admin:read");
    return (
      (await this.repository.getRetentionPolicy(subject.orgId)) ??
      defaultRetentionPolicy(subject)
    );
  }

  async updateRetentionPolicy(input: {
    subject: AuthSubject;
    auditLogRetentionDays: number;
    runEventRetentionDays?: number;
    fileRetentionDays?: number | null;
    workspaceFileRetentionDays?: Record<string, number | null>;
    userFileRetentionDays?: Record<string, number | null>;
  }): Promise<RetentionPolicy> {
    assertScope(input.subject, "admin:write");
    if (
      input.auditLogRetentionDays < 30 ||
      input.auditLogRetentionDays > 3650
    ) {
      throw new ApiError(
        "invalid_retention_policy",
        "Audit retention must be between 30 and 3650 days.",
        400,
      );
    }
    const current =
      (await this.repository.getRetentionPolicy(input.subject.orgId)) ??
      defaultRetentionPolicy(input.subject);
    const runEventRetentionDays =
      input.runEventRetentionDays ?? current.runEventRetentionDays;
    if (
      !Number.isInteger(runEventRetentionDays) ||
      runEventRetentionDays < 1 ||
      runEventRetentionDays > 3650
    ) {
      throw new ApiError(
        "invalid_retention_policy",
        "Run event retention must be between 1 and 3650 days.",
        400,
      );
    }
    const fileRetentionDays =
      input.fileRetentionDays === undefined
        ? current.fileRetentionDays
        : input.fileRetentionDays;
    const workspaceFileRetentionDays =
      input.workspaceFileRetentionDays ?? current.workspaceFileRetentionDays;
    const userFileRetentionDays =
      input.userFileRetentionDays ?? current.userFileRetentionDays;
    validateFileRetentionDays(fileRetentionDays);
    await this.validateRetentionOverrides({
      subject: input.subject,
      workspaceFileRetentionDays,
      userFileRetentionDays,
    });

    const updatedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const policy = await repository.upsertRetentionPolicy({
        orgId: input.subject.orgId,
        auditLogRetentionDays: input.auditLogRetentionDays,
        runEventRetentionDays,
        fileRetentionDays,
        workspaceFileRetentionDays,
        userFileRetentionDays,
        updatedBy: input.subject.id,
        updatedAt,
      });
      await writeAuditLog(repository, {
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "governance.retention.update",
        resourceType: "organization",
        resourceId: input.subject.orgId,
        outcome: "success",
        metadata: {
          auditLogRetentionDays: input.auditLogRetentionDays,
          runEventRetentionDays,
          fileRetentionDays,
          workspaceOverrideCount: Object.keys(workspaceFileRetentionDays)
            .length,
          userOverrideCount: Object.keys(userFileRetentionDays).length,
        },
        createdAt: updatedAt,
      });
      return policy;
    });
  }

  async enforceRetention(
    subject: AuthSubject,
  ): Promise<RetentionEnforcementResult> {
    assertScope(subject, "admin:write");
    const policy = await retentionPolicyForOrg(this.repository, subject);
    const enforcedAt = new Date();
    const cutoffAt = new Date(
      enforcedAt.getTime() - policy.auditLogRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const runEventCutoffAt = new Date(
      enforcedAt.getTime() - policy.runEventRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const auditExportGate = await this.repository.auditRetentionExportGate(
      subject.orgId,
      cutoffAt,
    );
    if (!auditExportGate.deletable)
      throw new ApiError(
        "audit_export_confirmation_required",
        "Audit retention is blocked until every required export destination confirms readback.",
        409,
        {
          blockedDestinationCount: auditExportGate.blockedDestinationIds.length,
          requiredThroughSequence: auditExportGate.requiredThroughSequence,
        },
      );
    const browserArtifacts = await this.enforceBrowserArtifactRetention(
      subject,
      cutoffAt,
      enforcedAt.toISOString(),
    );
    const voiceArtifacts = await this.enforceVoiceArtifactRetention(
      subject,
      cutoffAt,
      enforcedAt.toISOString(),
    );
    const dataExportPackages = await enforceGovernedDataExportPackageRetention({
      repository: this.repository,
      objectStore: this.objectStore,
      orgId: subject.orgId,
      cutoffAt,
    });
    const files = await enforceFileRetentionBatches({
      enforcedAt: enforcedAt.toISOString(),
      objectStore: this.objectStore,
      policy,
      repository: this.repository,
      subject,
    });
    const retentionCounts = await this.repository.transaction(
      async (repository) => {
        const deletedRunEventCount =
          await repository.deleteCompactedRunEventsBefore(
            subject.orgId,
            runEventCutoffAt,
            enforcedAt.toISOString(),
            10_000,
          );
        const deletedAuditLogCount = await repository.deleteAuditLogsBefore(
          subject.orgId,
          cutoffAt,
        );
        await writeAuditLog(repository, {
          id: createId("audit"),
          orgId: subject.orgId,
          actorId: subject.id,
          action: "governance.retention.enforce",
          resourceType: "organization",
          resourceId: subject.orgId,
          outcome: "success",
          metadata: {
            auditLogRetentionDays: policy.auditLogRetentionDays,
            runEventRetentionDays: policy.runEventRetentionDays,
            cutoffAt,
            runEventCutoffAt,
            cleanedBrowserAutomationJobCount:
              browserArtifacts.cleanedBrowserAutomationJobCount,
            deletedBrowserAutomationArtifactCount:
              browserArtifacts.deletedBrowserAutomationArtifactCount,
            cleanedVoiceArtifactUsageEventCount:
              voiceArtifacts.cleanedVoiceArtifactUsageEventCount,
            deletedVoiceArtifactCount: voiceArtifacts.deletedVoiceArtifactCount,
            missingVoiceArtifactCount: voiceArtifacts.missingVoiceArtifactCount,
            deletedDataExportPackageCount:
              dataExportPackages.deletedDataExportPackageCount,
            missingDataExportPackageCount:
              dataExportPackages.missingDataExportPackageCount,
            deletedFileObjectCount: files.deletedFileObjectCount,
            missingFileObjectCount: files.missingFileObjectCount,
            deletedFileObjectBytes: files.deletedFileObjectBytes,
            deletedAuditLogCount,
            deletedRunEventCount,
            runEventCompactionLimitReached: deletedRunEventCount === 10_000,
          },
          createdAt: enforcedAt.toISOString(),
        });
        return { deletedAuditLogCount, deletedRunEventCount };
      },
    );
    return {
      orgId: subject.orgId,
      auditLogRetentionDays: policy.auditLogRetentionDays,
      runEventRetentionDays: policy.runEventRetentionDays,
      cutoffAt,
      runEventCutoffAt,
      cleanedBrowserAutomationJobCount:
        browserArtifacts.cleanedBrowserAutomationJobCount,
      deletedBrowserAutomationArtifactCount:
        browserArtifacts.deletedBrowserAutomationArtifactCount,
      cleanedVoiceArtifactUsageEventCount:
        voiceArtifacts.cleanedVoiceArtifactUsageEventCount,
      deletedVoiceArtifactCount: voiceArtifacts.deletedVoiceArtifactCount,
      missingVoiceArtifactCount: voiceArtifacts.missingVoiceArtifactCount,
      deletedDataExportPackageCount:
        dataExportPackages.deletedDataExportPackageCount,
      missingDataExportPackageCount:
        dataExportPackages.missingDataExportPackageCount,
      deletedFileObjectCount: files.deletedFileObjectCount,
      missingFileObjectCount: files.missingFileObjectCount,
      deletedFileObjectBytes: files.deletedFileObjectBytes,
      fileRetentionBacklogRemaining: files.backlogRemaining,
      ...(files.cursor === undefined
        ? {}
        : { fileRetentionCursor: files.cursor }),
      fileRetentionLegalHoldSkippedCount: files.legalHoldSkippedCount,
      fileRetentionMetadataFailureCount: files.metadataFailureCount,
      ...(files.oldestCandidateAgeSeconds === undefined
        ? {}
        : {
            fileRetentionOldestCandidateAgeSeconds:
              files.oldestCandidateAgeSeconds,
          }),
      fileRetentionScannedFileObjectCount: files.scannedFileObjectCount,
      deletedAuditLogCount: retentionCounts.deletedAuditLogCount,
      deletedRunEventCount: retentionCounts.deletedRunEventCount,
      runEventCompactionLimitReached:
        retentionCounts.deletedRunEventCount === 10_000,
      enforcedAt: enforcedAt.toISOString(),
    };
  }

  private async validateRetentionOverrides(input: {
    subject: AuthSubject;
    workspaceFileRetentionDays: Record<string, number | null>;
    userFileRetentionDays: Record<string, number | null>;
  }): Promise<void> {
    if (
      Object.keys(input.workspaceFileRetentionDays).length > 500 ||
      Object.keys(input.userFileRetentionDays).length > 500
    )
      throw new ApiError(
        "invalid_retention_policy",
        "File retention supports at most 500 workspace and 500 user overrides.",
        400,
      );
    const workspaces = new Set(
      (await this.repository.listWorkspaces(input.subject.orgId)).map(
        (workspace) => workspace.id,
      ),
    );
    const users = new Set(
      (await this.repository.listUsers(input.subject.orgId)).map(
        (user) => user.id,
      ),
    );
    for (const [workspaceId, days] of Object.entries(
      input.workspaceFileRetentionDays,
    )) {
      validateFileRetentionDays(days);
      if (!workspaces.has(workspaceId))
        throw new ApiError(
          "invalid_retention_workspace",
          "A file retention workspace override references an unknown workspace.",
          400,
          { workspaceId },
        );
    }
    for (const [userId, days] of Object.entries(input.userFileRetentionDays)) {
      validateFileRetentionDays(days);
      if (!users.has(userId))
        throw new ApiError(
          "invalid_retention_user",
          "A file retention user override references an unknown user.",
          400,
          { userId },
        );
    }
  }

  private async enforceVoiceArtifactRetention(
    subject: AuthSubject,
    cutoffAt: string,
    enforcedAt: string,
  ): Promise<{
    cleanedVoiceArtifactUsageEventCount: number;
    deletedVoiceArtifactCount: number;
    missingVoiceArtifactCount: number;
  }> {
    const cutoffMs = Date.parse(cutoffAt);
    if (!Number.isFinite(cutoffMs)) {
      return {
        cleanedVoiceArtifactUsageEventCount: 0,
        deletedVoiceArtifactCount: 0,
        missingVoiceArtifactCount: 0,
      };
    }
    let cleanedVoiceArtifactUsageEventCount = 0;
    let deletedVoiceArtifactCount = 0;
    let missingVoiceArtifactCount = 0;
    const events = await this.repository.listUsageEvents(subject.orgId);
    for (const event of events) {
      const artifact = readVoiceArtifactUsageMetadata(event);
      const createdAtMs = Date.parse(event.createdAt);
      if (
        artifact === undefined ||
        !Number.isFinite(createdAtMs) ||
        createdAtMs >= cutoffMs
      ) {
        continue;
      }
      const existing = await this.objectStore.getObject(artifact.storageKey);
      if (existing === undefined) {
        missingVoiceArtifactCount += 1;
      } else {
        await this.objectStore.deleteObject(artifact.storageKey);
        deletedVoiceArtifactCount += 1;
      }
      await updateRecordedUsage(this.repository, {
        ...event,
        metadata: redactVoiceArtifactStorageMetadata(
          event.metadata,
          artifact.storageKey,
          {
            artifactDeletedAt: enforcedAt,
            artifactDeletionReason: "retention",
          },
        ),
      });
      cleanedVoiceArtifactUsageEventCount += 1;
    }
    return {
      cleanedVoiceArtifactUsageEventCount,
      deletedVoiceArtifactCount,
      missingVoiceArtifactCount,
    };
  }

  private async enforceBrowserArtifactRetention(
    subject: AuthSubject,
    cutoffAt: string,
    enforcedAt: string,
  ): Promise<{
    cleanedBrowserAutomationJobCount: number;
    deletedBrowserAutomationArtifactCount: number;
  }> {
    const cutoffMs = Date.parse(cutoffAt);
    if (!Number.isFinite(cutoffMs)) {
      return {
        cleanedBrowserAutomationJobCount: 0,
        deletedBrowserAutomationArtifactCount: 0,
      };
    }
    let cleanedBrowserAutomationJobCount = 0;
    let deletedBrowserAutomationArtifactCount = 0;
    const jobs = iterateBackgroundJobs(this.repository, subject.orgId, {
      statuses: ["completed", "failed"],
      type: browserAutomationJobType,
    });
    for await (const job of jobs) {
      if (job.status !== "completed" && job.status !== "failed") {
        continue;
      }
      const artifacts = readBrowserAutomationStoredArtifacts(job);
      const expired = artifacts.filter((artifact) => {
        const registeredAtMs = Date.parse(artifact.registeredAt);
        return Number.isFinite(registeredAtMs) && registeredAtMs < cutoffMs;
      });
      if (expired.length === 0) continue;
      for (const artifact of expired) {
        await this.objectStore.deleteObject(artifact.storageKey);
      }
      const expiredIds = new Set(
        expired.map((artifact) => artifact.artifactId),
      );
      const remaining = artifacts.filter(
        (artifact) => !expiredIds.has(artifact.artifactId),
      );
      await this.repository.updateBackgroundJob({
        ...job,
        payload:
          remaining.length === 0
            ? withoutBrowserArtifacts(job.payload)
            : { ...job.payload, browserArtifacts: remaining },
        updatedAt: enforcedAt,
      });
      cleanedBrowserAutomationJobCount += 1;
      deletedBrowserAutomationArtifactCount += expired.length;
    }
    return {
      cleanedBrowserAutomationJobCount,
      deletedBrowserAutomationArtifactCount,
    };
  }
}
import { writeAuditLog } from "./audit-log";
