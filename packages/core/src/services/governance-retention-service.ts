import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";

import type {
  RetentionEnforcementResult,
  RetentionPolicy,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { enforceGovernedDataExportPackageRetention } from "./data-export-package";
import { deleteFileObjectStoredObjects } from "./file-service";
import { isFileRetentionDeletable } from "./file-lifecycle";
import {
  defaultRetentionPolicy,
  effectiveFileExpiry,
  retentionPolicyForOrg,
  validateFileRetentionDays,
  withoutBrowserArtifacts,
} from "./governance-retention-policy";
import {
  browserAutomationJobType,
  readBrowserAutomationStoredArtifacts,
} from "./workflow-browser-tasks";
import {
  readVoiceArtifactUsageMetadata,
  redactVoiceArtifactStorageMetadata,
} from "./voice-artifact-metadata";
import { updateRecordedUsage } from "./record-usage";

export interface GovernanceServiceOptions {
  env?: RomeoEnv | undefined;
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
    runEventRetentionDays: number;
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
    if (
      !Number.isInteger(input.runEventRetentionDays) ||
      input.runEventRetentionDays < 1 ||
      input.runEventRetentionDays > 3650
    ) {
      throw new ApiError(
        "invalid_retention_policy",
        "Run event retention must be between 1 and 3650 days.",
        400,
      );
    }
    const current =
      (await this.repository.getRetentionPolicy(input.subject.orgId)) ??
      defaultRetentionPolicy(input.subject);
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
        runEventRetentionDays: input.runEventRetentionDays,
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
          runEventRetentionDays: input.runEventRetentionDays,
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
    const files = await this.enforceFileRetention(
      subject,
      policy,
      enforcedAt.toISOString(),
    );
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

  private async enforceFileRetention(
    subject: AuthSubject,
    policy: RetentionPolicy,
    enforcedAt: string,
  ): Promise<{
    deletedFileObjectCount: number;
    missingFileObjectCount: number;
    deletedFileObjectBytes: number;
  }> {
    let deletedFileObjectCount = 0;
    let missingFileObjectCount = 0;
    let deletedFileObjectBytes = 0;
    const enforcedAtMs = Date.parse(enforcedAt);
    for (const file of await this.repository.listFileObjects(subject.orgId)) {
      if (!isFileRetentionDeletable(file)) continue;
      const expiresAt = effectiveFileExpiry(file, policy);
      if (expiresAt === undefined || Date.parse(expiresAt) > enforcedAtMs)
        continue;
      const deletionPlan = await this.repository.getDataDeletionPlan(
        subject.orgId,
        "file_object",
        file.id,
      );
      if (deletionPlan?.legalHold !== undefined) continue;
      const stored = await this.objectStore.getObject(file.objectKey);
      if (stored === undefined) missingFileObjectCount += 1;
      else deletedFileObjectBytes += stored.byteLength;
      // Always run the complete object cleanup. The primary object may already
      // be missing while resumable-upload or derived keys still remain.
      await deleteFileObjectStoredObjects(this.objectStore, file);
      await this.repository.deleteDataForResource(
        subject.orgId,
        "file_object",
        file.id,
      );
      deletedFileObjectCount += 1;
    }
    return {
      deletedFileObjectCount,
      missingFileObjectCount,
      deletedFileObjectBytes,
    };
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
    const jobs = await this.repository.listBackgroundJobs(subject.orgId);
    for (const job of jobs) {
      if (
        job.type !== browserAutomationJobType ||
        (job.status !== "completed" && job.status !== "failed")
      ) {
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
