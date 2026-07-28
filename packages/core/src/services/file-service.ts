import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import { FileDirectUploadService } from "./file-direct-upload-service";
import {
  FileAccessService,
  type FileContentResponse,
  type FileListPageInput,
  type FileListPageResponse,
} from "./file-access-service";
import type { QuotaCoordinator } from "./quota-coordination";
import { assertWorkspaceActive } from "./workspace-guard";
import {
  disabledKnowledgeBinaryExtractor,
  type KnowledgeBinaryExtractor,
} from "./knowledge-extraction-worker";
import { disabledFileOcrProvider, type FileOcrProvider } from "./file-ocr";
import { FilePipelineSupport } from "./file-pipeline-support";
import { publicFileObject } from "./file-object-state";
import { FileResumableUploadService } from "./file-resumable-upload-service";
import {
  type CreateFileObjectInput,
  type CreateFileResumableUploadSessionInput,
  type CreateFileUploadSessionInput,
  type FileMalwareScanner,
  type FileMalwareScanPolicy,
  type FileObjectResponse,
  type FileResumableUploadSessionResponse,
  type FileServiceLimits,
  type FileUploadSessionResponse,
} from "./file-service-contracts";
import { normalizeFileInput, sha256Hex } from "./file-upload-normalization";

export {
  assertFileMalwareScanClean,
  type CreateFileObjectInput,
  type CreateFileResumableUploadSessionInput,
  type CreateFileUploadSessionInput,
  type FileExtractionState,
  type FileExtractionStatus,
  type FileMalwareScanner,
  type FileMalwareScanPolicy,
  type FileObjectResponse,
  type FileResumableUploadPartResponse,
  type FileResumableUploadSessionResponse,
  type FileServiceLimits,
  type FileUploadSessionResponse,
} from "./file-service-contracts";
export {
  deleteFileObjectStoredObjects,
  fileObjectStoredObjectCount,
} from "./file-resumable-helpers";

const defaultInlineMaxBytes = 25_000_000;
const defaultDirectUploadMaxBytes = 100_000_000;
const defaultResumableUploadMaxBytes = 500_000_000;

export class FileService {
  private readonly access: FileAccessService;
  private readonly directUploads: FileDirectUploadService;
  private readonly limits: FileServiceLimits;
  private readonly pipeline: FilePipelineSupport;
  private readonly resumableUploads: FileResumableUploadService;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore = disabledObjectStore,
    private readonly quotaCoordinator?: QuotaCoordinator,
    limits: Partial<FileServiceLimits> = {},
    private readonly malwareScanning: {
      policy: FileMalwareScanPolicy;
      scanner?: FileMalwareScanner;
    } = { policy: "off" },
    private readonly extractor: KnowledgeBinaryExtractor = disabledKnowledgeBinaryExtractor,
    private readonly ocrProvider: FileOcrProvider = disabledFileOcrProvider,
  ) {
    this.limits = {
      directUploadMaxBytes:
        limits.directUploadMaxBytes ?? defaultDirectUploadMaxBytes,
      inlineMaxBytes: limits.inlineMaxBytes ?? defaultInlineMaxBytes,
      resumableUploadMaxBytes:
        limits.resumableUploadMaxBytes ?? defaultResumableUploadMaxBytes,
    };
    this.pipeline = new FilePipelineSupport(
      repository,
      objectStore,
      malwareScanning,
      extractor,
      ocrProvider,
    );
    this.access = new FileAccessService(repository, objectStore, this.pipeline);
    this.resumableUploads = new FileResumableUploadService(
      repository,
      objectStore,
      this.access,
      this.pipeline,
      this.limits,
      quotaCoordinator,
    );
    this.directUploads = new FileDirectUploadService(
      repository,
      objectStore,
      this.access,
      this.pipeline,
      this.resumableUploads,
      this.limits,
      quotaCoordinator,
    );
  }

  list(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<FileObjectResponse[]> {
    return this.access.list(subject, workspaceId);
  }

  listPage(
    subject: AuthSubject,
    input: FileListPageInput,
  ): Promise<FileListPageResponse> {
    return this.access.listPage(subject, input);
  }

  get(subject: AuthSubject, fileId: string): Promise<FileObjectResponse> {
    return this.access.get(subject, fileId);
  }

  async create(
    subject: AuthSubject,
    input: CreateFileObjectInput,
  ): Promise<FileObjectResponse> {
    const pipelineStartedAt = Date.now();
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
    await this.pipeline.assertMalwareScanClean(
      normalized.bytes,
      normalized.fileName,
      normalized.mimeType,
    );
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "file.upload",
      workspaceId: input.workspaceId,
    });
    const sha256 = sha256Hex(normalized.bytes);
    const duplicateMetadata = await this.pipeline.duplicateContentMetadata({
      subject,
      workspaceId: input.workspaceId,
      sha256,
      purpose: input.purpose ?? "general",
    });
    const fileId = createId("file");
    const objectKey = `files/${subject.orgId}/${input.workspaceId}/${fileId}/${normalized.fileName}`;
    await this.pipeline.traceObjectStore(
      subject,
      input.workspaceId,
      fileId,
      "put",
      () =>
        this.objectStore.putObject({
          key: objectKey,
          body: normalized.bytes,
          contentType: normalized.mimeType,
        }),
    );
    const extraction = await this.pipeline.extractFile(normalized, 1);

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
          sha256,
          objectKey,
          purpose: input.purpose ?? "general",
          status: "available",
          metadata: {
            ...(input.metadata ?? {}),
            ...duplicateMetadata,
            extraction,
          },
          createdAt: now,
          updatedAt: now,
        });
        await this.pipeline.createOwnerFileGrants(repository, subject, file);
        await this.pipeline.audit(repository, subject, "file.create", file, {
          purpose: file.purpose,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        });
        return file;
      })
      .catch(async (error: unknown) => {
        await this.pipeline
          .traceObjectStore(
            subject,
            input.workspaceId,
            fileId,
            "delete_rollback",
            () => this.objectStore.deleteObject(objectKey),
          )
          .catch(() => {});
        throw error;
      });
    await this.pipeline.recordUploadPipeline(
      subject,
      file,
      "inline",
      pipelineStartedAt,
    );
    return publicFileObject(file);
  }

  createUploadSession(
    subject: AuthSubject,
    input: CreateFileUploadSessionInput,
  ): Promise<FileUploadSessionResponse> {
    return this.directUploads.create(subject, input);
  }

  createResumableUploadSession(
    subject: AuthSubject,
    input: CreateFileResumableUploadSessionInput,
  ): Promise<FileResumableUploadSessionResponse> {
    return this.resumableUploads.create(subject, input);
  }

  getResumableUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileResumableUploadSessionResponse> {
    return this.resumableUploads.get(subject, fileId);
  }

  completeResumableUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    return this.resumableUploads.complete(subject, fileId);
  }

  getUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileUploadSessionResponse> {
    return this.directUploads.get(subject, fileId);
  }

  completeUploadSession(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    return this.directUploads.complete(subject, fileId);
  }

  readContent(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileContentResponse> {
    return this.access.readContent(subject, fileId);
  }

  retryExtraction(
    subject: AuthSubject,
    fileId: string,
  ): Promise<FileObjectResponse> {
    return this.access.retryExtraction(subject, fileId);
  }

  delete(subject: AuthSubject, fileId: string): Promise<FileObjectResponse> {
    return this.access.delete(subject, fileId);
  }
}
