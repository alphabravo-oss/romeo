import type { FileObjectPurpose, FileObjectStatus } from "@romeo/core";
import { ApiError } from "@romeo/core";

import type { FileObjectRecord } from "./file-repository";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";
import { objectRecords } from "./schema";

export function toFileObjectRecord(
  row: typeof objectRecords.$inferSelect,
): FileObjectRecord {
  const record: FileObjectRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    ownerType: row.ownerType === "service_account" ? "service_account" : "user",
    ownerId: row.ownerId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    objectKey: row.objectKey,
    purpose: normalizePurpose(row.purpose),
    status: normalizeStatus(row.status),
    lifecycleVersion: row.lifecycleVersion,
    lifecycleAttempts: row.lifecycleAttempts,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const deletedAt = optionalIsoString(row.deletedAt);
  if (deletedAt !== undefined) record.deletedAt = deletedAt;
  assignOptional(record, "lifecycleFailureCode", row.lifecycleFailureCode);
  assignOptional(record, "lifecycleLeaseOwner", row.lifecycleLeaseOwner);
  assignOptional(record, "lifecycleLeaseToken", row.lifecycleLeaseToken);
  assignOptionalIso(
    record,
    "lifecycleNextAttemptAt",
    row.lifecycleNextAttemptAt,
  );
  assignOptionalIso(
    record,
    "lifecycleLeaseExpiresAt",
    row.lifecycleLeaseExpiresAt,
  );
  assignOptionalIso(record, "attachedAt", row.attachedAt);
  assignOptionalIso(record, "retainedAt", row.retainedAt);
  return record;
}

export function toFileObjectInsert(
  record: FileObjectRecord,
): typeof objectRecords.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    ownerType: record.ownerType,
    ownerId: record.ownerId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    objectKey: record.objectKey,
    purpose: record.purpose,
    status: record.status,
    lifecycleVersion: record.lifecycleVersion ?? 0,
    lifecycleAttempts: record.lifecycleAttempts ?? 0,
    lifecycleFailureCode: record.lifecycleFailureCode,
    lifecycleNextAttemptAt: optionalDate(record.lifecycleNextAttemptAt),
    lifecycleLeaseOwner: record.lifecycleLeaseOwner,
    lifecycleLeaseToken: record.lifecycleLeaseToken,
    lifecycleLeaseExpiresAt: optionalDate(record.lifecycleLeaseExpiresAt),
    attachedAt: optionalDate(record.attachedAt),
    retainedAt: optionalDate(record.retainedAt),
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    deletedAt: optionalDate(record.deletedAt),
  };
}

export function toFileObjectUpdate(record: FileObjectRecord) {
  return {
    deletedAt: optionalDate(record.deletedAt),
    fileName: record.fileName,
    metadata: record.metadata,
    mimeType: record.mimeType,
    objectKey: record.objectKey,
    ownerId: record.ownerId,
    ownerType: record.ownerType,
    purpose: record.purpose,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    status: record.status,
    lifecycleVersion: record.lifecycleVersion ?? 0,
    lifecycleAttempts: record.lifecycleAttempts ?? 0,
    lifecycleFailureCode: record.lifecycleFailureCode ?? null,
    lifecycleNextAttemptAt: optionalDate(record.lifecycleNextAttemptAt),
    lifecycleLeaseOwner: record.lifecycleLeaseOwner ?? null,
    lifecycleLeaseToken: record.lifecycleLeaseToken ?? null,
    lifecycleLeaseExpiresAt: optionalDate(record.lifecycleLeaseExpiresAt),
    attachedAt: optionalDate(record.attachedAt),
    retainedAt: optionalDate(record.retainedAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function lifecycleVersionConflict(): ApiError {
  return new ApiError(
    "file_lifecycle_version_conflict",
    "The file lifecycle changed before this operation completed.",
    409,
  );
}

const statuses = new Set<string>([
  "attached",
  "available",
  "deleted",
  "extracting",
  "failed",
  "quarantined",
  "ready",
  "retained",
  "scanning",
  "transcoding",
  "uploading",
]);

function normalizeStatus(value: string): FileObjectStatus {
  return statuses.has(value) ? (value as FileObjectStatus) : "failed";
}

const purposes = new Set<string>([
  "browser_artifact",
  "chat_attachment",
  "connector_import",
  "export_bundle",
  "general",
  "generated_image",
  "knowledge_source",
  "memory",
  "note",
  "web_source",
  "voice_artifact",
]);

function normalizePurpose(value: string): FileObjectPurpose {
  return purposes.has(value) ? (value as FileObjectPurpose) : "general";
}

function assignOptional<K extends keyof FileObjectRecord>(
  record: FileObjectRecord,
  key: K,
  value: string | null,
): void {
  if (value !== null) Object.assign(record, { [key]: value });
}

function assignOptionalIso<K extends keyof FileObjectRecord>(
  record: FileObjectRecord,
  key: K,
  value: Date | null,
): void {
  const iso = optionalIsoString(value);
  if (iso !== undefined) Object.assign(record, { [key]: iso });
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
