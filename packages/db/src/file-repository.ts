import { and, asc, desc, eq } from "drizzle-orm";

import type { FileObjectPurpose, FileObjectStatus } from "@romeo/core";

import type { RomeoDatabase } from "./client";
import { objectRecords } from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export interface FileObjectRecord {
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

export class PgFileRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listFileObjects(
    orgId: string,
    workspaceId?: string,
  ): Promise<FileObjectRecord[]> {
    const rows = await this.db
      .select()
      .from(objectRecords)
      .where(
        workspaceId === undefined
          ? eq(objectRecords.orgId, orgId)
          : and(
              eq(objectRecords.orgId, orgId),
              eq(objectRecords.workspaceId, workspaceId),
            ),
      )
      .orderBy(desc(objectRecords.updatedAt), asc(objectRecords.id));
    return rows.map(toFileObjectRecord);
  }

  async getFileObject(fileId: string): Promise<FileObjectRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(objectRecords)
      .where(eq(objectRecords.id, fileId))
      .limit(1);
    return row === undefined ? undefined : toFileObjectRecord(row);
  }

  async createFileObject(file: FileObjectRecord): Promise<FileObjectRecord> {
    const [row] = await this.db
      .insert(objectRecords)
      .values(toFileObjectInsert(file))
      .returning();
    return row === undefined ? file : toFileObjectRecord(row);
  }

  async updateFileObject(file: FileObjectRecord): Promise<FileObjectRecord> {
    const [row] = await this.db
      .update(objectRecords)
      .set({
        deletedAt: optionalDate(file.deletedAt),
        fileName: file.fileName,
        metadata: file.metadata,
        mimeType: file.mimeType,
        objectKey: file.objectKey,
        ownerId: file.ownerId,
        ownerType: file.ownerType,
        purpose: file.purpose,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        status: file.status,
        updatedAt: new Date(file.updatedAt),
      })
      .where(eq(objectRecords.id, file.id))
      .returning();
    return row === undefined ? file : toFileObjectRecord(row);
  }
}

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
    status:
      row.status === "deleted"
        ? "deleted"
        : row.status === "uploading"
          ? "uploading"
          : "available",
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const deletedAt = optionalIsoString(row.deletedAt);
  if (deletedAt !== undefined) record.deletedAt = deletedAt;
  return record;
}

function toFileObjectInsert(
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
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    deletedAt: optionalDate(record.deletedAt),
  };
}

function normalizePurpose(value: string): FileObjectPurpose {
  return fileObjectPurposes.has(value)
    ? (value as FileObjectPurpose)
    : "general";
}

const fileObjectPurposes = new Set<string>([
  "browser_artifact",
  "chat_attachment",
  "connector_import",
  "export_bundle",
  "general",
  "generated_image",
  "knowledge_source",
  "voice_artifact",
]);

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
