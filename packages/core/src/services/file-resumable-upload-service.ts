import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

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
import {
  expectedPartSize,
  normalizeResumableUploadPlan,
  partNumbers,
  resumablePartObjectKey,
  resumablePlanFromFile,
  type ResumableUploadPlan,
} from "./file-resumable-helpers";
import type {
  CreateFileResumableUploadSessionInput,
  FileObjectResponse,
  FileResumableUploadPartResponse,
  FileResumableUploadSessionResponse,
  FileServiceLimits,
} from "./file-service-contracts";
import { assertFileContentMatchesMimeType } from "./file-signature";
import {
  normalizeFileMetadataInput,
  sha256Hex,
} from "./file-upload-normalization";
import type { QuotaCoordinator } from "./quota-coordination";
import { assertWorkspaceActive } from "./workspace-guard";

const uploadUrlExpiresInSeconds = 900;

export class FileResumableUploadService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly access: FileAccessService,
    private readonly pipeline: FilePipelineSupport,
    private readonly limits: FileServiceLimits,
    private readonly quotaCoordinator?: QuotaCoordinator,
  ) {}

  async create(
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
          partCount: resumable.partCount,
          partSizeBytes: resumable.partSizeBytes,
          uploadMode: "resumable_backend_composed",
          extraction: initialExtractionState(normalized.mimeType),
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.pipeline.createOwnerFileGrants(repository, subject, created);
      await this.pipeline.audit(
        repository,
        subject,
        "file.resumable_upload.create",
        created,
        {
          partCount: resumable.partCount,
          partSizeBytes: resumable.partSizeBytes,
          purpose: created.purpose,
          sizeBytes: created.sizeBytes,
          mimeType: created.mimeType,
        },
      );
      return created;
    });
    return this.sessionResponse(subject, file, resumable);
  }

  async get(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileResumableUploadSessionResponse> {
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
    return this.sessionResponse(subject, file, resumablePlanFromFile(file));
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
    const resumable = resumablePlanFromFile(file);
    const bytes = await this.readParts(subject, file, resumable);
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
    await this.pipeline.scanUploadedFileOrReject(
      file,
      bytes,
      partNumbers(resumable.partCount).map((partNumber) =>
        resumablePartObjectKey(file.objectKey, partNumber),
      ),
    );
    const duplicateMetadata = await this.pipeline.duplicateContentMetadata({
      subject,
      workspaceId: file.workspaceId,
      sha256: file.sha256,
      purpose: file.purpose,
      excludeFileId: file.id,
    });
    await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "put_composed",
      () =>
        this.objectStore.putObject({
          key: file.objectKey,
          body: bytes,
          contentType: file.mimeType,
        }),
    );
    const extraction = await this.pipeline.extractFile(
      { bytes, fileName: file.fileName, mimeType: file.mimeType },
      extractionAttempts(file) + 1,
    );
    const completed = await this.repository
      .transaction(async (repository) => {
        const result = await repository.updateFileObject({
          ...file,
          status: "available",
          metadata: { ...file.metadata, ...duplicateMetadata, extraction },
          updatedAt: new Date().toISOString(),
        });
        await this.pipeline.audit(
          repository,
          subject,
          "file.resumable_upload.complete",
          result,
          {
            partCount: resumable.partCount,
            partSizeBytes: resumable.partSizeBytes,
            purpose: result.purpose,
            sizeBytes: result.sizeBytes,
            mimeType: result.mimeType,
          },
        );
        return result;
      })
      .catch(async (error: unknown) => {
        await this.pipeline
          .traceObjectStore(
            subject,
            file.workspaceId,
            file.id,
            "delete_rollback",
            () => this.objectStore.deleteObject(file.objectKey),
          )
          .catch(() => {});
        throw error;
      });
    await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "delete_parts",
      () =>
        Promise.all(
          partNumbers(resumable.partCount).map((partNumber) =>
            this.objectStore.deleteObject(
              resumablePartObjectKey(file.objectKey, partNumber),
            ),
          ),
        ),
    );
    await this.pipeline.recordUploadPipeline(
      subject,
      completed,
      "resumable",
      pipelineStartedAt,
    );
    return publicFileObject(completed);
  }

  private async createPart(
    subject: AuthSubject,
    file: FileObject,
    resumable: ResumableUploadPlan,
    partNumber: number,
  ): Promise<FileResumableUploadPartResponse> {
    const upload = await this.pipeline.traceObjectStore(
      subject,
      file.workspaceId,
      file.id,
      "presign_part",
      () =>
        this.objectStore.createPresignedUpload({
          key: resumablePartObjectKey(file.objectKey, partNumber),
          contentType: "application/octet-stream",
          expiresInSeconds: uploadUrlExpiresInSeconds,
        }),
    );
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

  private async sessionResponse(
    subject: AuthSubject,
    file: FileObject,
    resumable: ResumableUploadPlan,
  ): Promise<FileResumableUploadSessionResponse> {
    const parts = await Promise.all(
      partNumbers(resumable.partCount).map((partNumber) =>
        this.createPart(subject, file, resumable, partNumber),
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

  private async readParts(
    subject: AuthSubject,
    file: FileObject,
    resumable: ResumableUploadPlan,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for (const partNumber of partNumbers(resumable.partCount)) {
      const bytes = await this.pipeline.traceObjectStore(
        subject,
        file.workspaceId,
        file.id,
        "get_part",
        () =>
          this.objectStore.getObject(
            resumablePartObjectKey(file.objectKey, partNumber),
          ),
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
}
