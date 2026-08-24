import type { AuthSubject } from "@romeo/auth";
import type { ExtractedKnowledgeText } from "@romeo/rag";
import type { ObjectStore } from "@romeo/storage";

import type {
  BackgroundJob,
  KnowledgeBase,
  KnowledgeSource,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import {
  canIngestInlineText,
  extractKnowledgeSourceBytes,
} from "./knowledge-ingestion";
import {
  createChunksForSource,
  hashKnowledgeContent,
} from "./knowledge-ingestion";
import { recordSubjectUsage } from "./record-usage";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";
import { readKnowledgeObject } from "./knowledge-object-read";
import { startWorkLeaseHeartbeat } from "./work-lease-heartbeat";

export interface KnowledgeBinaryExtractor {
  extract(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
    signal?: AbortSignal;
  }): Promise<ExtractedKnowledgeText>;
}

export interface KnowledgeExtractionJobResult {
  job: BackgroundJob;
  source: KnowledgeSource;
}

export const deferredExtractionMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const disabledKnowledgeBinaryExtractor: KnowledgeBinaryExtractor = {
  async extract(input) {
    throw new ApiError(
      "knowledge_extractor_unavailable",
      "Deferred knowledge extraction is not configured for this deployment.",
      503,
      {
        mimeType: input.mimeType,
      },
    );
  },
};

export function isDeferredExtractionMimeType(mimeType: string): boolean {
  return deferredExtractionMimeTypes.has(normalizeMimeType(mimeType));
}

export async function extractUploadedKnowledgeSource(input: {
  extractor: KnowledgeBinaryExtractor;
  knowledgeBaseId: string;
  objectStore: ObjectStore;
  repository: RomeoRepository;
  sourceId: string;
  subject: AuthSubject;
  webhooks?: WebhookEmitter | undefined;
}): Promise<KnowledgeExtractionJobResult> {
  const knowledgeBase = await getAuthorizedKnowledgeBase(input.repository, {
    knowledgeBaseId: input.knowledgeBaseId,
    subject: input.subject,
    scope: "knowledge:write",
    permission: "write",
  });
  const pendingSource = (
    await input.repository.listKnowledgeSources(knowledgeBase.id)
  ).find((item) => item.id === input.sourceId);
  if (!pendingSource) throw notFound("Knowledge source");
  if (pendingSource.objectKey === undefined)
    throw new ApiError(
      "upload_object_missing",
      "Knowledge source does not have an uploaded object key.",
      409,
    );

  const claimedAt = new Date().toISOString();
  const leaseToken = createId("knowledge_extraction_lease");
  const source = await input.repository.claimKnowledgeSourceExtraction({
    knowledgeBaseId: knowledgeBase.id,
    leaseExpiresAt: new Date(Date.parse(claimedAt) + 300_000).toISOString(),
    leaseOwner: input.subject.id,
    leaseToken,
    now: claimedAt,
    sourceId: pendingSource.id,
  });
  if (source?.extractionLease === undefined)
    throw new ApiError(
      "knowledge_extraction_lease_unavailable",
      "The knowledge source is already being extracted.",
      409,
    );
  if (source.objectKey === undefined)
    throw new ApiError(
      "upload_object_missing",
      "Knowledge source does not have an uploaded object key.",
      409,
    );
  const job = await startBackgroundJob(input.repository, {
    orgId: knowledgeBase.orgId,
    workspaceId: knowledgeBase.workspaceId,
    type: "knowledge.extract",
    payload: {
      knowledgeBaseId: knowledgeBase.id,
      sourceId: source.id,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
    },
  });
  const heartbeat = startWorkLeaseHeartbeat({
    leaseDurationMs: 300_000,
    lostError: () =>
      new ApiError(
        "knowledge_extraction_lease_lost",
        "The knowledge extraction lease was lost.",
        409,
      ),
    renew: async (lease) =>
      (await input.repository.renewKnowledgeSourceExtractionLease({
        sourceId: source.id,
        fencingToken: source.extractionLease!.fencingToken,
        leaseOwner: source.extractionLease!.owner,
        leaseToken,
        ...lease,
      })) !== undefined,
  });

  try {
    const bytes = await readKnowledgeObject(input.objectStore, {
      key: source.objectKey,
      sizeBytes: source.sizeBytes,
    });
    const extracted = await extractKnowledgeBytes(
      input.extractor,
      source,
      bytes,
    );
    const chunks = createChunksForSource(
      source,
      extracted.content,
      extracted.metadata,
    );
    const completedAt = new Date().toISOString();
    const contentHash = await hashKnowledgeContent(extracted.content);
    await heartbeat.stop();
    const result = await input.repository.transaction(async (repository) => {
      const indexed = await repository.finishKnowledgeSourceExtraction({
        chunks,
        fencingToken: source.extractionLease!.fencingToken,
        leaseOwner: source.extractionLease!.owner,
        leaseToken: source.extractionLease!.token,
        now: completedAt,
        source: {
          ...source,
          chunkCount: chunks.length,
          contentHash,
          indexedAt: completedAt,
          sizeBytes: bytes.byteLength,
          status: chunks.length > 0 ? "indexed" : "failed",
          updatedAt: completedAt,
        },
      });
      if (indexed === undefined)
        throw new ApiError(
          "knowledge_extraction_lease_lost",
          "The knowledge extraction lease was lost before completion.",
          409,
        );
      await recordExtractionUsage(
        repository,
        input.subject,
        knowledgeBase,
        indexed,
        job,
        bytes.byteLength,
      );
      return {
        job: await completeBackgroundJob(repository, job),
        source: indexed,
      };
    });
    emitExtractionWebhook(
      input.webhooks,
      input.subject,
      knowledgeBase,
      result.source,
    );
    return result;
  } catch (error) {
    await heartbeat.stop({ requireOwned: false });
    const failedAt = new Date().toISOString();
    await input.repository.finishKnowledgeSourceExtraction({
      chunks: [],
      fencingToken: source.extractionLease.fencingToken,
      leaseOwner: source.extractionLease.owner,
      leaseToken: source.extractionLease.token,
      now: failedAt,
      source: { ...source, status: "failed", updatedAt: failedAt },
    });
    await failBackgroundJob(
      input.repository,
      job,
      error instanceof Error ? error.constructor.name : "unknown_error",
    );
    throw error;
  }
}

async function extractKnowledgeBytes(
  extractor: KnowledgeBinaryExtractor,
  source: KnowledgeSource,
  bytes: Uint8Array,
): Promise<ExtractedKnowledgeText> {
  if (canIngestInlineText(source.mimeType))
    return extractKnowledgeSourceBytes(bytes, source.mimeType);
  if (!isDeferredExtractionMimeType(source.mimeType)) {
    throw new ApiError(
      "unsupported_media_type",
      "Knowledge source type is not supported for extraction.",
      415,
      { mimeType: source.mimeType },
    );
  }
  return extractor.extract({
    bytes,
    fileName: source.fileName,
    mimeType: source.mimeType,
  });
}

async function recordExtractionUsage(
  repository: RomeoRepository,
  subject: AuthSubject,
  knowledgeBase: KnowledgeBase,
  source: KnowledgeSource,
  job: BackgroundJob,
  sizeBytes: number,
): Promise<void> {
  await recordSubjectUsage(repository, subject, {
    orgId: knowledgeBase.orgId,
    workspaceId: knowledgeBase.workspaceId,
    sourceType: "storage",
    sourceId: source.id,
    metric: "storage.source_extracted",
    quantity: sizeBytes,
    unit: "byte",
    metadata: {
      jobId: job.id,
      knowledgeBaseId: knowledgeBase.id,
      chunkCount: source.chunkCount ?? 0,
      mimeType: source.mimeType,
    },
  });
}

function emitExtractionWebhook(
  webhooks: WebhookEmitter | undefined,
  subject: AuthSubject,
  knowledgeBase: KnowledgeBase,
  source: KnowledgeSource,
): void {
  emitWebhookEvent(webhooks, {
    orgId: knowledgeBase.orgId,
    eventType: "knowledge.source.indexed",
    payload: {
      sourceId: source.id,
      knowledgeBaseId: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      actorId: subject.id,
      fileName: source.fileName,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      status: source.status,
      chunkCount: source.chunkCount ?? 0,
      indexedAt: source.indexedAt,
    },
  });
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
