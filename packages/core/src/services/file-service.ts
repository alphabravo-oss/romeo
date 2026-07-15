import { createHash } from "node:crypto";

import {
  AuthorizationError,
  assertScope,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";
import {
  disabledObjectStore,
  type ObjectStore,
  type PresignedUpload,
} from "@romeo/storage";

import type { FileObject, FileObjectPurpose } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import { assertFileContentMatchesMimeType } from "./file-signature";
import type { QuotaCoordinator } from "./quota-coordination";
import { writeAuditLog } from "./audit-log";
import { assertWorkspaceActive } from "./workspace-guard";

const defaultInlineMaxBytes = 25_000_000;
const defaultDirectUploadMaxBytes = 100_000_000;
const defaultResumableUploadMaxBytes = 500_000_000;
const directUploadUrlExpiresInSeconds = 900;
const defaultResumablePartSizeBytes = 16_000_000;
const maxResumablePartCount = 1_000;

const allowedMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export interface FileObjectResponse {
  id: string;
  workspaceId: string;
  ownerType: "service_account" | "user";
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose: FileObjectPurpose;
  status: "available" | "deleted" | "uploading";
  metadata: Record<string, unknown>;
  contentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateFileObjectInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  purpose?: FileObjectPurpose | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateFileUploadSessionInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose?: FileObjectPurpose | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateFileResumableUploadSessionInput extends CreateFileUploadSessionInput {
  partSizeBytes?: number | undefined;
}

export interface FileUploadSessionResponse {
  file: FileObjectResponse;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
    maxBytes: number;
  };
}

export interface FileResumableUploadPartResponse {
  partNumber: number;
  sizeBytes: number;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface FileResumableUploadSessionResponse {
  file: FileObjectResponse;
  upload: {
    mode: "resumable_backend_composed";
    partCount: number;
    partSizeBytes: number;
    maxBytes: number;
    parts: FileResumableUploadPartResponse[];
  };
}

export interface FileServiceLimits {
  directUploadMaxBytes: number;
  inlineMaxBytes: number;
  resumableUploadMaxBytes: number;
}

export class FileService {
  private readonly limits: FileServiceLimits;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore = disabledObjectStore,
    private readonly quotaCoordinator?: QuotaCoordinator,
    limits: Partial<FileServiceLimits> = {},
  ) {
    this.limits = {
      directUploadMaxBytes:
        limits.directUploadMaxBytes ?? defaultDirectUploadMaxBytes,
      inlineMaxBytes: limits.inlineMaxBytes ?? defaultInlineMaxBytes,
      resumableUploadMaxBytes:
        limits.resumableUploadMaxBytes ?? defaultResumableUploadMaxBytes,
    };
  }

  async list(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<FileObjectResponse[]> {
    assertScope(subject, "files:read");
    if (
      workspaceId !== undefined &&
      !hasWorkspaceAccess(subject, workspaceId)
    ) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }

    const [files, grants] = await Promise.all([
      this.repository.listFileObjects(subject.orgId, workspaceId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    return files
      .filter((file) => file.status === "available")
      .filter((file) => hasWorkspaceAccess(subject, file.workspaceId))
      .filter((file) => canReadFile(subject, grants, file))
      .map(publicFileObject);
  }

  async get(subject: AuthSubject, fileId: string): Promise<FileObjectResponse> {
    return publicFileObject(
      await this.authorizedFile(subject, fileId, "files:read", "read"),
    );
  }

  async create(
    subject: AuthSubject,
    input: CreateFileObjectInput,
  ): Promise<FileObjectResponse> {
    assertScope(subject, "files:write");
    if (!hasWorkspaceAccess(subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId: input.workspaceId,
    });

    const normalized = normalizeFileInput(input, this.limits.inlineMaxBytes);
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "file.upload",
      workspaceId: input.workspaceId,
    });
    const fileId = createId("file");
    const objectKey = `files/${subject.orgId}/${input.workspaceId}/${fileId}/${normalized.fileName}`;
    await this.objectStore.putObject({
      key: objectKey,
      body: normalized.bytes,
      contentType: normalized.mimeType,
    });

    const now = new Date().toISOString();
    const file = await this.repository
      .transaction(async (repository) => {
        await consumeQuota(
          repository,
          subject,
          {
            metric: "storage.byte",
            quantity: normalized.bytes.byteLength,
            workspaceId: input.workspaceId,
          },
          { quotaCoordinator: this.quotaCoordinator },
        );
        const file = await repository.createFileObject({
          id: fileId,
          orgId: subject.orgId,
          workspaceId: input.workspaceId,
          ownerType: subject.type,
          ownerId: subject.id,
          fileName: normalized.fileName,
          mimeType: normalized.mimeType,
          sizeBytes: normalized.bytes.byteLength,
          sha256: sha256Hex(normalized.bytes),
          objectKey,
          purpose: input.purpose ?? "general",
          status: "available",
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        });
        await this.createOwnerFileGrants(repository, subject, file);
        await this.audit(repository, subject, "file.create", file, {
          purpose: file.purpose,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        });
        return file;
      })
      .catch(async (error: unknown) => {
        await this.objectStore.deleteObject(objectKey).catch(() => {});
        throw error;
      });
    return publicFileObject(file);
  }

  async createUploadSession(
    subject: AuthSubject,
    input: CreateFileUploadSessionInput,
  ): Promise<FileUploadSessionResponse> {
    assertScope(subject, "files:write");
    if (!hasWorkspaceAccess(subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId: input.workspaceId,
    });

    const normalized = normalizeFileMetadataInput(
      input,
      this.limits.directUploadMaxBytes,
    );
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "file.upload",
      workspaceId: input.workspaceId,
    });
    const fileId = createId("file");
    const objectKey = `files/${subject.orgId}/${input.workspaceId}/${fileId}/${normalized.fileName}`;
    const upload = await this.createPresignedUpload(objectKey, normalized);
    const now = new Date().toISOString();
    const file = await this.repository.transaction(async (repository) => {
      await consumeQuota(
        repository,
        subject,
        {
          metric: "storage.byte",
          quantity: normalized.sizeBytes,
          workspaceId: input.workspaceId,
        },
        { quotaCoordinator: this.quotaCoordinator },
      );
      const file = await repository.createFileObject({
        id: fileId,
        orgId: subject.orgId,
        workspaceId: input.workspaceId,
        ownerType: subject.type,
        ownerId: subject.id,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        sha256: normalized.sha256,
        objectKey,
        purpose: input.purpose ?? "general",
        status: "uploading",
        metadata: {
          ...(input.metadata ?? {}),
          uploadMode: "direct_presigned_put",
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.createOwnerFileGrants(repository, subject, file);
      await this.audit(
        repository,
        subject,
        "file.upload_session.create",
        file,
        {
          purpose: file.purpose,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        },
      );
      return file;
    });
    return uploadSessionResponse(
      file,
      upload,
      this.limits.directUploadMaxBytes,
    );
  }

  async createResumableUploadSession(
    subject: AuthSubject,
    input: CreateFileResumableUploadSessionInput,
  ): Promise<FileResumableUploadSessionResponse> {
    assertScope(subject, "files:write");
    if (!hasWorkspaceAccess(subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId: input.workspaceId,
    });

    const normalized = normalizeFileMetadataInput(
      input,
      this.limits.resumableUploadMaxBytes,
    );
    const resumable = normalizeResumableUploadPlan(
      normalized.sizeBytes,
      input.partSizeBytes,
      this.limits.directUploadMaxBytes,
    );
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "file.upload",
      workspaceId: input.workspaceId,
    });
    const fileId = createId("file");
    const objectKey = `files/${subject.orgId}/${input.workspaceId}/${fileId}/${normalized.fileName}`;
    const now = new Date().toISOString();
    const file = await this.repository.transaction(async (repository) => {
      await consumeQuota(
        repository,
        subject,
        {
          metric: "storage.byte",
          quantity: normalized.sizeBytes,
          workspaceId: input.workspaceId,
        },
        { quotaCoordinator: this.quotaCoordinator },
      );
      const file = await repository.createFileObject({
        id: fileId,
        orgId: subject.orgId,
        workspaceId: input.workspaceId,
        ownerType: subject.type,
        ownerId: subject.id,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        sha256: normalized.sha256,
        objectKey,
        purpose: input.purpose ?? "general",
        status: "uploading",
        metadata: {
          ...(input.metadata ?? {}),
          partCount: resumable.partCount,
          partSizeBytes: resumable.partSizeBytes,
          uploadMode: "resumable_backend_composed",
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.createOwnerFileGrants(repository, subject, file);
      await this.audit(
        repository,
        subject,
        "file.resumable_upload.create",
        file,
        {
          partCount: resumable.partCount,
          partSizeBytes: resumable.partSizeBytes,
          purpose: file.purpose,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        },
      );
      return file;
    });
    return this.resumableUploadSessionResponse(file, resumable);
  }

  async getResumableUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileResumableUploadSessionResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status !== "uploading") {
      throw new ApiError(
        "file_upload_not_active",
        "The file upload session is not active.",
        409,
      );
    }
    return this.resumableUploadSessionResponse(
      file,
      resumablePlanFromFile(file),
    );
  }

  async completeResumableUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status === "available") return publicFileObject(file);
    if (file.status !== "uploading") {
      throw new ApiError(
        "file_upload_not_active",
        "The file upload session is not active.",
        409,
      );
    }
    const resumable = resumablePlanFromFile(file);
    const bytes = await this.readResumableParts(file, resumable);
    if (bytes.byteLength !== file.sizeBytes) {
      throw new ApiError(
        "file_size_mismatch",
        "Uploaded file byte count does not match the declared size.",
        400,
      );
    }
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== file.sha256) {
      throw new ApiError(
        "file_sha256_mismatch",
        "Uploaded file checksum does not match the declared checksum.",
        400,
      );
    }
    assertFileContentMatchesMimeType(bytes, file.mimeType);
    await this.objectStore.putObject({
      key: file.objectKey,
      body: bytes,
      contentType: file.mimeType,
    });
    const now = new Date().toISOString();
    const completed = await this.repository
      .transaction(async (repository) => {
        const completed = await repository.updateFileObject({
          ...file,
          status: "available",
          updatedAt: now,
        });
        await this.audit(
          repository,
          subject,
          "file.resumable_upload.complete",
          completed,
          {
            partCount: resumable.partCount,
            partSizeBytes: resumable.partSizeBytes,
            purpose: completed.purpose,
            sizeBytes: completed.sizeBytes,
            mimeType: completed.mimeType,
          },
        );
        return completed;
      })
      .catch(async (error: unknown) => {
        await this.objectStore.deleteObject(file.objectKey).catch(() => {});
        throw error;
      });
    await Promise.all(
      partNumbers(resumable.partCount).map((partNumber) =>
        this.objectStore.deleteObject(
          resumablePartObjectKey(file.objectKey, partNumber),
        ),
      ),
    );
    return publicFileObject(completed);
  }

  async getUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileUploadSessionResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status !== "uploading") {
      throw new ApiError(
        "file_upload_not_active",
        "The file upload session is not active.",
        409,
      );
    }
    return uploadSessionResponse(
      file,
      await this.createPresignedUpload(file.objectKey, {
        mimeType: file.mimeType,
      }),
      this.limits.directUploadMaxBytes,
    );
  }

  async completeUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status === "available") return publicFileObject(file);
    if (file.status !== "uploading") {
      throw new ApiError(
        "file_upload_not_active",
        "The file upload session is not active.",
        409,
      );
    }
    if (isResumableUploadFile(file)) {
      return this.completeResumableUploadSession(subject, fileId);
    }
    const bytes = await this.objectStore.getObject(file.objectKey);
    if (bytes === undefined) {
      throw new ApiError(
        "file_upload_missing",
        "The uploaded file object was not found.",
        409,
      );
    }
    if (bytes.byteLength !== file.sizeBytes) {
      throw new ApiError(
        "file_size_mismatch",
        "Uploaded file byte count does not match the declared size.",
        400,
      );
    }
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== file.sha256) {
      throw new ApiError(
        "file_sha256_mismatch",
        "Uploaded file checksum does not match the declared checksum.",
        400,
      );
    }
    assertFileContentMatchesMimeType(bytes, file.mimeType);
    const now = new Date().toISOString();
    const completed = await this.repository.transaction(async (repository) => {
      const completed = await repository.updateFileObject({
        ...file,
        status: "available",
        updatedAt: now,
      });
      await this.audit(
        repository,
        subject,
        "file.upload_session.complete",
        completed,
        {
          purpose: completed.purpose,
          sizeBytes: completed.sizeBytes,
          mimeType: completed.mimeType,
        },
      );
      return completed;
    });
    return publicFileObject(completed);
  }

  async readContent(
    subject: AuthSubject,
    fileId: string,
  ): Promise<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:read",
      "read",
    );
    if (file.status !== "available") {
      throw new ApiError(
        "file_upload_not_complete",
        "The file is not available for content readback.",
        409,
      );
    }
    const bytes = await this.objectStore.getObject(file.objectKey);
    if (bytes === undefined) {
      throw new ApiError(
        "file_object_missing",
        "The stored object for this file was not found.",
        409,
      );
    }
    return {
      bytes,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: bytes.byteLength,
    };
  }

  async delete(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status === "deleted") return publicFileObject(file);
    const now = new Date().toISOString();
    const deleted = await this.repository.transaction(async (repository) => {
      const deleted = await repository.updateFileObject({
        ...file,
        status: "deleted",
        deletedAt: now,
        updatedAt: now,
      });
      await this.audit(repository, subject, "file.delete", deleted, {
        purpose: deleted.purpose,
        sizeBytes: deleted.sizeBytes,
        mimeType: deleted.mimeType,
      });
      return deleted;
    });
    await deleteFileObjectStoredObjects(this.objectStore, file);
    return publicFileObject(deleted);
  }

  private async authorizedFile(
    subject: AuthSubject,
    fileId: string,
    scope: "files:read" | "files:write",
    permission: "read" | "write",
  ): Promise<FileObject> {
    assertScope(subject, scope);
    const file = await this.repository.getFileObject(fileId);
    if (
      file === undefined ||
      file.orgId !== subject.orgId ||
      file.status === "deleted"
    ) {
      throw notFound("File");
    }
    if (!hasWorkspaceAccess(subject, file.workspaceId)) {
      throw new AuthorizationError(
        "The file workspace is outside the caller access.",
      );
    }
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasFilePermission(subject, grants, file, permission)) {
      throw new AuthorizationError(
        `Missing ${permission} permission for file:${file.id}`,
      );
    }
    return file;
  }

  private createPresignedUpload(
    objectKey: string,
    file: { mimeType: string },
  ): Promise<PresignedUpload> {
    return this.objectStore.createPresignedUpload({
      key: objectKey,
      contentType: file.mimeType,
      expiresInSeconds: directUploadUrlExpiresInSeconds,
    });
  }

  private async createResumablePart(
    file: FileObject,
    resumable: ResumableUploadPlan,
    partNumber: number,
  ): Promise<FileResumableUploadPartResponse> {
    const upload = await this.objectStore.createPresignedUpload({
      key: resumablePartObjectKey(file.objectKey, partNumber),
      contentType: "application/octet-stream",
      expiresInSeconds: directUploadUrlExpiresInSeconds,
    });
    return {
      partNumber,
      sizeBytes: expectedPartSize(file.sizeBytes, resumable, partNumber),
      upload: {
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt,
      },
    };
  }

  private async resumableUploadSessionResponse(
    file: FileObject,
    resumable: ResumableUploadPlan,
  ): Promise<FileResumableUploadSessionResponse> {
    const parts = await Promise.all(
      partNumbers(resumable.partCount).map((partNumber) =>
        this.createResumablePart(file, resumable, partNumber),
      ),
    );
    return {
      file: publicFileObject(file),
      upload: {
        mode: "resumable_backend_composed",
        partCount: resumable.partCount,
        partSizeBytes: resumable.partSizeBytes,
        maxBytes: this.limits.resumableUploadMaxBytes,
        parts,
      },
    };
  }

  private async readResumableParts(
    file: FileObject,
    resumable: ResumableUploadPlan,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for (const partNumber of partNumbers(resumable.partCount)) {
      const bytes = await this.objectStore.getObject(
        resumablePartObjectKey(file.objectKey, partNumber),
      );
      if (bytes === undefined) {
        throw new ApiError(
          "file_upload_part_missing",
          "An uploaded file part was not found.",
          409,
          { partNumber },
        );
      }
      const expectedSize = expectedPartSize(
        file.sizeBytes,
        resumable,
        partNumber,
      );
      if (bytes.byteLength !== expectedSize) {
        throw new ApiError(
          "file_part_size_mismatch",
          "Uploaded file part byte count does not match the declared upload plan.",
          400,
          { partNumber, expectedSize },
        );
      }
      chunks.push(bytes);
    }
    const combined = new Uint8Array(file.sizeBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  private async createOwnerFileGrants(
    repository: RomeoRepository,
    subject: AuthSubject,
    file: FileObject,
  ): Promise<void> {
    await Promise.all([
      repository.createResourceGrant({
        id: createId("grant"),
        resourceType: "file",
        resourceId: file.id,
        principalType: subject.type,
        principalId: subject.id,
        permission: "read",
      }),
      repository.createResourceGrant({
        id: createId("grant"),
        resourceType: "file",
        resourceId: file.id,
        principalType: subject.type,
        principalId: subject.id,
        permission: "write",
      }),
    ]);
  }

  private audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    file: FileObject,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return writeAuditLog(repository, {
      subject,
      action,
      resourceType: "file",
      resourceId: file.id,
      metadata: { workspaceId: file.workspaceId, ...metadata },
    });
  }
}

export async function deleteFileObjectStoredObjects(
  objectStore: ObjectStore,
  file: FileObject,
): Promise<void> {
  const keys = fileObjectStoredObjectKeys(file);
  await Promise.all(keys.map((key) => objectStore.deleteObject(key)));
}

export function fileObjectStoredObjectCount(
  file: Pick<FileObject, "metadata">,
): number {
  if (!isResumableUploadFile(file)) return 1;
  return resumablePlanFromFile(file).partCount + 1;
}

function fileObjectStoredObjectKeys(file: FileObject): string[] {
  const keys: string[] = [];
  if (isResumableUploadFile(file)) {
    const resumable = resumablePlanFromFile(file);
    keys.push(
      ...partNumbers(resumable.partCount).map((partNumber) =>
        resumablePartObjectKey(file.objectKey, partNumber),
      ),
    );
  }
  keys.push(file.objectKey);
  return keys;
}

interface ResumableUploadPlan {
  partCount: number;
  partSizeBytes: number;
}

function normalizeResumableUploadPlan(
  sizeBytes: number,
  requestedPartSizeBytes: number | undefined,
  directUploadMaxBytes: number,
): ResumableUploadPlan {
  const partSizeBytes = requestedPartSizeBytes ?? defaultResumablePartSizeBytes;
  if (
    !Number.isInteger(partSizeBytes) ||
    partSizeBytes <= 0 ||
    partSizeBytes > directUploadMaxBytes
  ) {
    throw new ApiError(
      "file_part_size_invalid",
      "Resumable upload part size is outside the supported range.",
      400,
      { maxPartSizeBytes: directUploadMaxBytes },
    );
  }
  const partCount = Math.ceil(sizeBytes / partSizeBytes);
  if (partCount > maxResumablePartCount) {
    throw new ApiError(
      "file_part_count_invalid",
      "Resumable upload requires too many parts.",
      400,
      { maxPartCount: maxResumablePartCount },
    );
  }
  return { partCount, partSizeBytes };
}

function isResumableUploadFile(file: Pick<FileObject, "metadata">): boolean {
  return file.metadata.uploadMode === "resumable_backend_composed";
}

function resumablePlanFromFile(
  file: Pick<FileObject, "metadata">,
): ResumableUploadPlan {
  if (!isResumableUploadFile(file)) {
    throw new ApiError(
      "file_upload_mode_mismatch",
      "The file upload session is not resumable.",
      409,
    );
  }
  const partCount = file.metadata.partCount;
  const partSizeBytes = file.metadata.partSizeBytes;
  if (
    typeof partCount !== "number" ||
    typeof partSizeBytes !== "number" ||
    !Number.isInteger(partCount) ||
    partCount <= 0 ||
    partCount > maxResumablePartCount ||
    !Number.isInteger(partSizeBytes) ||
    partSizeBytes <= 0
  ) {
    throw new ApiError(
      "file_upload_plan_invalid",
      "The file upload session metadata is invalid.",
      409,
    );
  }
  return {
    partCount: Number(partCount),
    partSizeBytes: Number(partSizeBytes),
  };
}

function partNumbers(partCount: number): number[] {
  return Array.from({ length: partCount }, (_value, index) => index + 1);
}

function expectedPartSize(
  totalSizeBytes: number,
  resumable: ResumableUploadPlan,
  partNumber: number,
): number {
  if (partNumber < resumable.partCount) return resumable.partSizeBytes;
  return totalSizeBytes - resumable.partSizeBytes * (resumable.partCount - 1);
}

function resumablePartObjectKey(objectKey: string, partNumber: number): string {
  return `${objectKey}.parts/${String(partNumber).padStart(6, "0")}`;
}

function canReadFile(
  subject: AuthSubject,
  grants: ResourceGrant[],
  file: FileObject,
): boolean {
  return hasFilePermission(subject, grants, file, "read");
}

function hasFilePermission(
  subject: AuthSubject,
  grants: ResourceGrant[],
  file: FileObject,
  permission: "read" | "write",
): boolean {
  if (subject.isAdmin === true) return true;
  if (file.ownerType === subject.type && file.ownerId === subject.id)
    return true;
  return hasGrant(subject, grants, "file", file.id, permission);
}

function publicFileObject(file: FileObject): FileObjectResponse {
  return {
    id: file.id,
    workspaceId: file.workspaceId,
    ownerType: file.ownerType,
    ownerId: file.ownerId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    purpose: file.purpose,
    status: file.status,
    metadata: file.metadata,
    contentUrl:
      file.status === "available"
        ? `/api/v1/files/${encodeURIComponent(file.id)}/content`
        : null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.deletedAt === undefined ? {} : { deletedAt: file.deletedAt }),
  };
}

function uploadSessionResponse(
  file: FileObject,
  upload: PresignedUpload,
  directUploadMaxBytes: number,
): FileUploadSessionResponse {
  return {
    file: publicFileObject(file),
    upload: {
      url: upload.url,
      method: upload.method,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
      maxBytes: directUploadMaxBytes,
    },
  };
}

function normalizeFileInput(
  input: CreateFileObjectInput,
  inlineMaxBytes: number,
): {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
} {
  const metadata = normalizeFileMetadataInput(input, inlineMaxBytes);
  const maxBase64Length = base64LengthLimitFor(inlineMaxBytes);
  if (input.dataBase64.length > maxBase64Length) {
    throw new ApiError(
      "file_base64_too_large",
      "File upload encoding is outside the supported range.",
      400,
      { maxBase64Length },
    );
  }
  const bytes = decodeBase64(input.dataBase64);
  if (bytes.byteLength !== input.sizeBytes) {
    throw new ApiError(
      "file_size_mismatch",
      "File byte count does not match the declared size.",
      400,
    );
  }
  assertFileContentMatchesMimeType(bytes, metadata.mimeType);
  return { bytes, fileName: metadata.fileName, mimeType: metadata.mimeType };
}

function base64LengthLimitFor(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024;
}

function normalizeFileMetadataInput(
  input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256?: string;
  },
  maxBytes: number,
): {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
} {
  const mimeType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ApiError(
      "unsupported_file_type",
      "The file type is not supported for direct upload.",
      415,
      { mimeType: input.mimeType },
    );
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maxBytes
  ) {
    throw new ApiError(
      "file_size_invalid",
      "File size is outside the supported range.",
      400,
      { maxBytes },
    );
  }
  return {
    fileName: safeFileName(input.fileName),
    mimeType,
    sizeBytes: input.sizeBytes,
    sha256:
      input.sha256 === undefined ? "" : normalizeExpectedSha256(input.sha256),
  };
}

function decodeBase64(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (
    raw.length === 0 ||
    raw.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(raw)
  ) {
    throw new ApiError(
      "file_base64_invalid",
      "File must be valid base64.",
      400,
    );
  }
  return new Uint8Array(Buffer.from(raw, "base64"));
}

function safeFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).pop()?.trim() ?? "";
  const normalized = leaf
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? "upload" : normalized;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeExpectedSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ApiError(
      "file_sha256_invalid",
      "File checksum must be a lowercase SHA-256 hex digest.",
      400,
    );
  }
  return normalized;
}
