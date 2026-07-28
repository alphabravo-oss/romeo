import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { FileObject, FileObjectPurpose } from "../domain/entities";
import { fileTombstoneFields } from "../domain/file-tombstone";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  canReadFile,
  hasFilePermission,
  publicExtractionState,
  publicFileObject,
} from "./file-object-state";
import { FilePipelineSupport } from "./file-pipeline-support";
import { deleteFileObjectStoredObjects } from "./file-resumable-helpers";
import type { FileObjectResponse } from "./file-service-contracts";

export interface FileContentResponse {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface FileListPageInput {
  excludePurposes?: FileObjectPurpose[];
  limit: number;
  offset: number;
  query?: string;
  workspaceId: string;
}

export interface FileListPageResponse {
  items: FileObjectResponse[];
  limit: number;
  offset: number;
  total: number;
}

export class FileAccessService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly pipeline: FilePipelineSupport,
  ) {}

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

  async listPage(
    subject: AuthSubject,
    input: FileListPageInput,
  ): Promise<FileListPageResponse> {
    assertScope(subject, "files:read");
    if (!hasWorkspaceAccess(subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    const page = await this.repository.listAuthorizedFileObjectsPage({
      accessMode: "file_grants",
      ...(input.excludePurposes === undefined
        ? {}
        : { excludePurposes: input.excludePurposes }),
      groupIds: subject.groupIds,
      isAdmin: subject.isAdmin === true,
      limit: input.limit,
      offset: input.offset,
      orgId: subject.orgId,
      principalId: subject.id,
      principalType: subject.type,
      ...(input.query === undefined ? {} : { query: input.query }),
      workspaceId: input.workspaceId,
    });
    return {
      items: page.items.map(publicFileObject),
      limit: input.limit,
      offset: input.offset,
      total: page.total,
    };
  }

  async get(subject: AuthSubject, fileId: string): Promise<FileObjectResponse> {
    return publicFileObject(
      await this.authorizedFile(subject, fileId, "files:read", "read"),
    );
  }

  async readContent(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileContentResponse> {
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
    const bytes = await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "get_content",
      () => this.objectStore.getObject(file.objectKey),
    );
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

  async retryExtraction(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    const file = await this.authorizedFile(
      subject,
      fileId,
      "files:write",
      "write",
    );
    if (file.status !== "available") {
      throw new ApiError(
        "file_not_available",
        "File extraction can only be retried after upload completes.",
        409,
      );
    }
    const current = publicExtractionState(file);
    if (current.status === "not_applicable") {
      throw new ApiError(
        "file_extraction_not_applicable",
        "This file type does not provide extractable document text.",
        409,
      );
    }
    if (current.status === "processing") {
      throw new ApiError(
        "file_extraction_in_progress",
        "File extraction is already in progress.",
        409,
      );
    }
    const bytes = await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "get_extraction",
      () => this.objectStore.getObject(file.objectKey),
    );
    if (bytes === undefined) {
      throw new ApiError(
        "file_object_missing",
        "The stored file object was not found.",
        409,
      );
    }
    const extraction = await this.pipeline.extractFile(
      { bytes, fileName: file.fileName, mimeType: file.mimeType },
      current.attempts + 1,
      new Date().toISOString(),
    );
    const updated = await this.repository.transaction(async (repository) => {
      const result = await repository.updateFileObject({
        ...file,
        metadata: { ...file.metadata, extraction },
        updatedAt: new Date().toISOString(),
      });
      await this.pipeline.audit(
        repository,
        subject,
        "file.extraction.retry",
        result,
        {
          attempts: extraction.attempts,
          extractionStatus: extraction.status,
          failureCode: extraction.failureCode,
          method: extraction.method,
        },
      );
      return result;
    });
    return publicFileObject(updated);
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
      const result = await repository.updateFileObject({
        ...file,
        ...fileTombstoneFields(file.id, now),
      });
      await this.pipeline.audit(repository, subject, "file.delete", result, {
        purpose: file.purpose,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      });
      return result;
    });
    await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "delete",
      () => deleteFileObjectStoredObjects(this.objectStore, file),
    );
    return publicFileObject(deleted);
  }

  async authorizedFile(
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
}
