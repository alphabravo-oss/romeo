import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { RetentionPolicy } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { deleteFileObjectStoredObjects } from "./file-service";
import { isFileRetentionDeletable } from "./file-lifecycle";
import { effectiveFileExpiry } from "./governance-retention-policy";

export interface FileRetentionBatchResult {
  backlogRemaining: boolean;
  cursor?: { id: string; updatedAt: string };
  deletedFileObjectBytes: number;
  deletedFileObjectCount: number;
  legalHoldSkippedCount: number;
  metadataFailureCount: number;
  missingFileObjectCount: number;
  oldestCandidateAgeSeconds?: number;
  scannedFileObjectCount: number;
}

export async function enforceFileRetentionBatches(input: {
  enforcedAt: string;
  maxCandidates?: number;
  objectStore: ObjectStore;
  policy: RetentionPolicy;
  repository: RomeoRepository;
  subject: AuthSubject;
}): Promise<FileRetentionBatchResult> {
  const maxCandidates = Math.max(
    1,
    Math.min(input.maxCandidates ?? 500, 5_000),
  );
  const batchSize = Math.min(100, maxCandidates);
  const settingKey = `retention-progress:${input.subject.orgId}:files`;
  let cursor = retentionCursor(
    (await input.repository.getSystemSetting(settingKey, input.subject.orgId))
      ?.value,
  );
  const result: FileRetentionBatchResult = {
    backlogRemaining: false,
    deletedFileObjectBytes: 0,
    deletedFileObjectCount: 0,
    legalHoldSkippedCount: 0,
    metadataFailureCount: 0,
    missingFileObjectCount: 0,
    scannedFileObjectCount: 0,
  };
  while (result.scannedFileObjectCount < maxCandidates) {
    const limit = Math.min(
      batchSize,
      maxCandidates - result.scannedFileObjectCount,
    );
    const candidates = await input.repository.listFileRetentionCandidates({
      ...(cursor === undefined ? {} : { after: cursor }),
      limit: limit + 1,
      orgId: input.subject.orgId,
    });
    const page = candidates.slice(0, limit);
    if (page.length === 0) {
      cursor = undefined;
      result.backlogRemaining = false;
      await persistCursor(
        input.repository,
        settingKey,
        input.subject.orgId,
        input.enforcedAt,
      );
      break;
    }
    if (result.oldestCandidateAgeSeconds === undefined) {
      result.oldestCandidateAgeSeconds = Math.max(
        0,
        Math.floor(
          (Date.parse(input.enforcedAt) - Date.parse(page[0]!.updatedAt)) /
            1_000,
        ),
      );
    }
    for (const candidate of page) {
      const processed = await processCandidate(input, candidate, result);
      if (!processed) {
        result.backlogRemaining = true;
        if (cursor !== undefined) result.cursor = cursor;
        await persistCursor(
          input.repository,
          settingKey,
          input.subject.orgId,
          input.enforcedAt,
          cursor,
        );
        return result;
      }
      cursor = { id: candidate.id, updatedAt: candidate.updatedAt };
      result.scannedFileObjectCount += 1;
    }
    await persistCursor(
      input.repository,
      settingKey,
      input.subject.orgId,
      input.enforcedAt,
      cursor,
    );
    if (candidates.length <= limit) {
      cursor = undefined;
      result.backlogRemaining = false;
      await persistCursor(
        input.repository,
        settingKey,
        input.subject.orgId,
        input.enforcedAt,
      );
      break;
    }
    result.backlogRemaining = true;
  }
  if (cursor !== undefined) result.cursor = cursor;
  return result;
}

async function processCandidate(
  input: Parameters<typeof enforceFileRetentionBatches>[0],
  candidate: Awaited<
    ReturnType<RomeoRepository["listFileRetentionCandidates"]>
  >[number],
  result: FileRetentionBatchResult,
): Promise<boolean> {
  const current = await input.repository.getFileObject(candidate.id);
  if (current === undefined || current.updatedAt !== candidate.updatedAt)
    return true;
  if (!isFileRetentionDeletable(current)) return true;
  const expiresAt = effectiveFileExpiry(current, input.policy);
  if (
    expiresAt === undefined ||
    Date.parse(expiresAt) > Date.parse(input.enforcedAt)
  )
    return true;
  const deletionPlan = await input.repository.getDataDeletionPlan(
    input.subject.orgId,
    "file_object",
    current.id,
  );
  if (deletionPlan?.legalHold !== undefined) {
    result.legalHoldSkippedCount += 1;
    return true;
  }
  if (input.objectStore.headObject === undefined) {
    result.metadataFailureCount += 1;
    return false;
  }
  let stored: Awaited<ReturnType<NonNullable<ObjectStore["headObject"]>>>;
  try {
    stored = await input.objectStore.headObject(current.objectKey);
  } catch {
    result.metadataFailureCount += 1;
    return false;
  }
  if (stored === undefined) result.missingFileObjectCount += 1;
  else result.deletedFileObjectBytes += stored.sizeBytes;
  await deleteFileObjectStoredObjects(input.objectStore, current);
  await input.repository.deleteDataForResource(
    input.subject.orgId,
    "file_object",
    current.id,
  );
  result.deletedFileObjectCount += 1;
  return true;
}

async function persistCursor(
  repository: RomeoRepository,
  key: string,
  orgId: string,
  updatedAt: string,
  cursor?: { id: string; updatedAt: string },
): Promise<void> {
  await repository.upsertSystemSetting(
    {
      key,
      value: {
        version: 1,
        ...(cursor === undefined ? { completedAt: updatedAt } : { cursor }),
      },
      updatedAt,
    },
    orgId,
  );
}

function retentionCursor(
  value: Record<string, unknown> | undefined,
): { id: string; updatedAt: string } | undefined {
  const cursor = value?.cursor;
  if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor))
    return undefined;
  const record = cursor as Record<string, unknown>;
  return typeof record.id === "string" &&
    typeof record.updatedAt === "string" &&
    Number.isFinite(Date.parse(record.updatedAt))
    ? { id: record.id, updatedAt: record.updatedAt }
    : undefined;
}
