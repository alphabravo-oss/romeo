import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { FileObject, FileObjectPurpose } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  extractionMethodFor,
  isExtractableMimeType,
  notApplicableExtractionState,
  publicExtractionState,
  safeExtractionFailureCode,
  successfulExtractionState,
} from "./file-object-state";
import { type FileOcrProvider } from "./file-ocr";
import {
  assertFileMalwareScanClean,
  type FileExtractionState,
  type FileMalwareScanner,
  type FileMalwareScanPolicy,
} from "./file-service-contracts";
import {
  isDeferredExtractionMimeType,
  type KnowledgeBinaryExtractor,
} from "./knowledge-extraction-worker";
import { recordSubjectUsage } from "./record-usage";
import { traceSubjectOperation } from "./trace-operation";

export class FilePipelineSupport {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly malwareScanning: {
      policy: FileMalwareScanPolicy;
      scanner?: FileMalwareScanner;
    },
    private readonly extractor: KnowledgeBinaryExtractor,
    private readonly ocrProvider: FileOcrProvider,
  ) {}

  async assertMalwareScanClean(
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
  ): Promise<void> {
    await assertFileMalwareScanClean(this.malwareScanning, {
      bytes,
      fileName,
      mimeType,
    });
  }

  async scanUploadedFileOrReject(
    file: FileObject,
    bytes: Uint8Array,
    objectKeys: string[],
  ): Promise<void> {
    try {
      await this.assertMalwareScanClean(bytes, file.fileName, file.mimeType);
    } catch (error) {
      if (error instanceof ApiError && error.code === "file_malware_detected") {
        await Promise.all(
          objectKeys.map((key) =>
            this.objectStore.deleteObject(key).catch(() => undefined),
          ),
        );
        const deletedAt = new Date().toISOString();
        await this.repository.updateFileObject({
          ...file,
          status: "deleted",
          deletedAt,
          updatedAt: deletedAt,
        });
      }
      throw error;
    }
  }

  async duplicateContentMetadata(input: {
    subject: AuthSubject;
    workspaceId: string;
    sha256: string;
    purpose: FileObjectPurpose;
    excludeFileId?: string;
  }): Promise<Record<string, unknown>> {
    const duplicate = (
      await this.repository.listFileObjects(
        input.subject.orgId,
        input.workspaceId,
      )
    ).find(
      (candidate) =>
        candidate.id !== input.excludeFileId &&
        candidate.status === "available" &&
        candidate.ownerType === input.subject.type &&
        candidate.ownerId === input.subject.id &&
        candidate.purpose === input.purpose &&
        candidate.sha256 === input.sha256,
    );
    return duplicate === undefined
      ? {}
      : {
          duplicateContentDetected: true,
          duplicateOfFileId: duplicate.id,
        };
  }

  async extractFile(
    input: { bytes: Uint8Array; fileName: string; mimeType: string },
    attempts: number,
    attemptedAt = new Date().toISOString(),
  ): Promise<FileExtractionState> {
    if (!isExtractableMimeType(input.mimeType)) {
      return notApplicableExtractionState();
    }
    try {
      if (input.mimeType.startsWith("image/")) {
        const ocr = await this.ocrProvider.recognize(input);
        return successfulExtractionState({
          attempts,
          attemptedAt,
          characterCount: ocr.content.length,
          method: "ocr",
          quality:
            ocr.confidence !== null && ocr.confidence >= 0.9
              ? "high"
              : "medium",
          provider: ocr.provider,
          pageCount: ocr.pageCount,
          confidence: ocr.confidence,
        });
      }
      if (!isDeferredExtractionMimeType(input.mimeType)) {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          input.bytes,
        );
        return successfulExtractionState({
          attempts,
          attemptedAt,
          characterCount: content.length,
          method: "utf8-text",
          quality: "high",
          provider: "native",
        });
      }
      let extracted;
      try {
        extracted = await this.extractor.extract(input);
      } catch (primaryError) {
        if (input.mimeType !== "application/pdf") throw primaryError;
        try {
          const ocr = await this.ocrProvider.recognize(input);
          return successfulExtractionState({
            attempts,
            attemptedAt,
            characterCount: ocr.content.length,
            method: "ocr",
            quality:
              ocr.confidence !== null && ocr.confidence >= 0.9
                ? "high"
                : "medium",
            provider: ocr.provider,
            pageCount: ocr.pageCount,
            confidence: ocr.confidence,
          });
        } catch (ocrError) {
          if (
            ocrError instanceof ApiError &&
            ocrError.code === "file_ocr_unavailable"
          ) {
            throw primaryError;
          }
          throw ocrError;
        }
      }
      const method =
        typeof extracted.metadata.extractor === "string"
          ? extracted.metadata.extractor
          : "document-text";
      return successfulExtractionState({
        attempts,
        attemptedAt,
        characterCount: extracted.content.length,
        method,
        quality: method === "ooxml-text" ? "high" : "medium",
        provider: "local-document",
      });
    } catch (error) {
      return {
        status: "failed",
        quality: "unknown",
        method: extractionMethodFor(input.mimeType),
        attempts,
        attemptedAt,
        completedAt: new Date().toISOString(),
        characterCount: null,
        failureCode: safeExtractionFailureCode(error),
        provider: null,
        pageCount: null,
        confidence: null,
      };
    }
  }

  async createOwnerFileGrants(
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

  async recordUploadPipeline(
    subject: AuthSubject,
    file: FileObject,
    uploadMode: "direct" | "inline" | "resumable",
    startedAt: number,
  ): Promise<void> {
    await recordSubjectUsage(this.repository, subject, {
      orgId: file.orgId,
      workspaceId: file.workspaceId,
      sourceType: "storage",
      sourceId: file.id,
      metric: "file.upload.pipeline_duration",
      quantity: Math.max(0, Date.now() - startedAt),
      unit: "millisecond",
      metadata: {
        uploadMode,
        mimeType: file.mimeType,
        purpose: file.purpose,
        sizeBytes: file.sizeBytes,
        extractionStatus: publicExtractionState(file).status,
      },
    }).catch(() => undefined);
  }

  traceObjectStore<T>(
    subject: AuthSubject,
    workspaceId: string,
    sourceId: string,
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    return traceSubjectOperation({
      repository: this.repository,
      subject,
      workspaceId,
      sourceId,
      boundary: "object_store",
      operation,
      execute,
    });
  }

  audit(
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
