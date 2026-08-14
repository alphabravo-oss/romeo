import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import {
  ObjectSizeLimitError,
  type ObjectStore,
  type PresignedUpload,
} from "@romeo/storage";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { FileAccessService } from "./file-access-service";
import { initialExtractionState, publicFileObject } from "./file-object-state";
import type { FilePipelineSupport } from "./file-pipeline-support";
import type { FileResumableUploadService } from "./file-resumable-upload-service";
import { isResumableUploadFile } from "./file-resumable-helpers";
import type {
  CreateFileUploadSessionInput,
  FileObjectResponse,
  FileServiceLimits,
  FileUploadSessionResponse,
} from "./file-service-contracts";
import { completeDirectUploadProtocol } from "./direct-upload-protocol";
import { assertFileContentMatchesMimeType } from "./file-signature";
import {
  normalizeFileMetadataInput,
  sha256Hex,
} from "./file-upload-normalization";
import { normalizeUploadedMedia } from "./media-normalization";
import type { QuotaCoordinator } from "./quota-coordination";
import { isFileReadyForUse } from "./file-lifecycle";
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
          ...input.metadata,
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
    const metadata = await this.objectStore.headObject?.(file.objectKey);
    const protocol = await completeDirectUploadProtocol({
      alreadyReady: isFileReadyForUse(file),
      status: file.status,
      isResumable: isResumableUploadFile(file),
      headSupported: this.objectStore.headObject !== undefined,
      ...(metadata === undefined ? {} : { head: metadata }),
      declaredSizeBytes: file.sizeBytes,
      maxBytes: this.limits.directUploadMaxBytes,
      sha256Declared: file.sha256,
      mimeType: file.mimeType,
      readBytes: async () => {
        try {
          return await this.pipeline.traceObjectStore(
            subject,
            file.workspaceId,
            file.id,
            "get_upload",
            () =>
              this.objectStore.getObject(file.objectKey, {
                maxBytes: Math.min(
                  file.sizeBytes,
                  this.limits.directUploadMaxBytes,
                ),
              }),
          );
        } catch (error) {
          if (error instanceof ObjectSizeLimitError) throw error;
          throw error;
        }
      },
      sha256Hex,
      assertMime: assertFileContentMatchesMimeType,
    });
    if (protocol.outcome === "already_ready") return publicFileObject(file);
    if (protocol.outcome === "resumable")
      return this.resumableUploads.complete(subject, fileId);
    if (protocol.outcome === "denied") {
      if (protocol.deleteObject)
        await this.objectStore.deleteObject(file.objectKey);
      throw new ApiError(
        protocol.code,
        protocol.code === "file_upload_not_active"
          ? "The file upload session is not active."
          : protocol.code === "file_upload_missing"
            ? "The uploaded file object was not found."
            : protocol.code === "file_sha256_mismatch"
              ? "Uploaded file checksum does not match the declared checksum."
              : protocol.code === "file_mime_mismatch"
                ? "File bytes do not match the declared MIME type."
                : "Uploaded file byte count does not match the declared size.",
        protocol.code === "file_upload_not_active" ||
          protocol.code === "file_upload_missing"
          ? 409
          : protocol.code === "file_mime_mismatch"
            ? 415
            : 400,
      );
    }
    const normalized = normalizeUploadedMedia({
      bytes: protocol.bytes,
      fileName: file.fileName,
      mimeType: file.mimeType,
      stripMetadata: true,
      retentionPermitsOriginal: file.purpose !== "ephemeral",
      signatureMatches: true,
    });
    if (normalized.outcome === "denied") {
      await this.objectStore.deleteObject(file.objectKey);
      throw new ApiError(
        normalized.code,
        "File bytes do not match the declared MIME type.",
        415,
      );
    }
    const bytes = normalized.bytes;
    const duplicateMetadata = await this.pipeline.duplicateContentMetadata({
      subject,
      workspaceId: file.workspaceId,
      sha256: file.sha256,
      purpose: file.purpose,
      excludeFileId: file.id,
    });
    const completed = await this.pipeline.processFileLifecycle({
      subject,
      file,
      bytes,
      objectKeys: [file.objectKey],
      metadata: duplicateMetadata,
    });
    try {
      await this.repository.transaction((repository) =>
        this.pipeline.audit(
          repository,
          subject,
          "file.upload_session.complete",
          completed,
          {
            purpose: completed.purpose,
            sizeBytes: completed.sizeBytes,
            mimeType: completed.mimeType,
          },
        ),
      );
    } catch (error) {
      await this.pipeline.failFileLifecycle(completed, error);
      throw error;
    }
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
    file: { mimeType: string; sha256?: string; sizeBytes?: number },
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
          ...(file.sha256 === undefined ? {} : { sha256: file.sha256 }),
          ...(file.sizeBytes === undefined
            ? {}
            : { sizeBytes: file.sizeBytes }),
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
