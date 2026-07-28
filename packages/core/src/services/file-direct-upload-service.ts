import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ObjectStore, PresignedUpload } from "@romeo/storage";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { FileAccessService } from "./file-access-service";
import {
  extractionAttempts,
  initialExtractionState,
  publicFileObject,
} from "./file-object-state";
import type { FilePipelineSupport } from "./file-pipeline-support";
import type { FileResumableUploadService } from "./file-resumable-upload-service";
import { isResumableUploadFile } from "./file-resumable-helpers";
import type {
  CreateFileUploadSessionInput,
  FileObjectResponse,
  FileServiceLimits,
  FileUploadSessionResponse,
} from "./file-service-contracts";
import { assertFileContentMatchesMimeType } from "./file-signature";
import {
  normalizeFileMetadataInput,
  sha256Hex,
} from "./file-upload-normalization";
import type { QuotaCoordinator } from "./quota-coordination";
import { assertWorkspaceActive } from "./workspace-guard";

const uploadUrlExpiresInSeconds = 900;

export class FileDirectUploadService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly access: FileAccessService,
    private readonly pipeline: FilePipelineSupport,
    private readonly resumableUploads: FileResumableUploadService,
    private readonly limits: FileServiceLimits,
    private readonly quotaCoordinator?: QuotaCoordinator,
  ) {}

  async create(
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
    const upload = await this.createPresignedUpload(
      subject,
      input.workspaceId,
      fileId,
      objectKey,
      normalized,
    );
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
      const created = await repository.createFileObject({
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
          extraction: initialExtractionState(normalized.mimeType),
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.pipeline.createOwnerFileGrants(repository, subject, created);
      await this.pipeline.audit(
        repository,
        subject,
        "file.upload_session.create",
        created,
        {
          purpose: created.purpose,
          sizeBytes: created.sizeBytes,
          mimeType: created.mimeType,
        },
      );
      return created;
    });
    return this.sessionResponse(file, upload);
  }

  async get(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileUploadSessionResponse> {
    const file = await this.access.authorizedFile(
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
    return this.sessionResponse(
      file,
      await this.createPresignedUpload(
        subject,
        file.workspaceId,
        file.id,
        file.objectKey,
        file,
      ),
    );
  }

  async complete(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    const pipelineStartedAt = Date.now();
    const file = await this.access.authorizedFile(
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
      return this.resumableUploads.complete(subject, fileId);
    }
    const bytes = await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "get_upload",
      () => this.objectStore.getObject(file.objectKey),
    );
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
    if (sha256Hex(bytes) !== file.sha256) {
      throw new ApiError(
        "file_sha256_mismatch",
        "Uploaded file checksum does not match the declared checksum.",
        400,
      );
    }
    assertFileContentMatchesMimeType(bytes, file.mimeType);
    await this.pipeline.scanUploadedFileOrReject(file, bytes, [file.objectKey]);
    const duplicateMetadata = await this.pipeline.duplicateContentMetadata({
      subject,
      workspaceId: file.workspaceId,
      sha256: file.sha256,
      purpose: file.purpose,
      excludeFileId: file.id,
    });
    const extraction = await this.pipeline.extractFile(
      { bytes, fileName: file.fileName, mimeType: file.mimeType },
      extractionAttempts(file) + 1,
    );
    const completed = await this.repository.transaction(async (repository) => {
      const result = await repository.updateFileObject({
        ...file,
        status: "available",
        metadata: { ...file.metadata, ...duplicateMetadata, extraction },
        updatedAt: new Date().toISOString(),
      });
      await this.pipeline.audit(
        repository,
        subject,
        "file.upload_session.complete",
        result,
        {
          purpose: result.purpose,
          sizeBytes: result.sizeBytes,
          mimeType: result.mimeType,
        },
      );
      return result;
    });
    await this.pipeline.recordUploadPipeline(
      subject,
      completed,
      "direct",
      pipelineStartedAt,
    );
    return publicFileObject(completed);
  }

  private createPresignedUpload(
    subject: AuthSubject,
    workspaceId: string,
    sourceId: string,
    objectKey: string,
    file: { mimeType: string },
  ): Promise<PresignedUpload> {
    return this.pipeline.traceObjectStore(
      subject,
      workspaceId,
      sourceId,
      "presign_put",
      () =>
        this.objectStore.createPresignedUpload({
          key: objectKey,
          contentType: file.mimeType,
          expiresInSeconds: uploadUrlExpiresInSeconds,
        }),
    );
  }

  private sessionResponse(
    file: FileObject,
    upload: PresignedUpload,
  ): FileUploadSessionResponse {
    return {
      file: publicFileObject(file),
      upload: {
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt,
        maxBytes: this.limits.directUploadMaxBytes,
      },
    };
  }
}
