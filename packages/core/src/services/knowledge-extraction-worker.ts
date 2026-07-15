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
import { indexKnowledgeSource } from "./knowledge-source-indexing";
import { recordSubjectUsage } from "./record-usage";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";

export interface KnowledgeBinaryExtractor {
  extract(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
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
  const source = (
    await input.repository.listKnowledgeSources(knowledgeBase.id)
  ).find((item) => item.id === input.sourceId);
  if (!source) throw notFound("Knowledge source");
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

  try {
    const bytes = await input.objectStore.getObject(source.objectKey);
    if (bytes === undefined)
      throw new ApiError(
        "upload_object_missing",
        "Uploaded object was not found in object storage.",
        409,
      );
    const extracted = await extractKnowledgeBytes(
      input.extractor,
      source,
      bytes,
    );
    const result = await input.repository.transaction(async (repository) => {
      const indexed = await indexKnowledgeSource(
        repository,
        { ...source, sizeBytes: bytes.byteLength },
        extracted.content,
        {
          metadata: extracted.metadata,
        },
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
    await input.repository.updateKnowledgeSource({
      ...source,
      status: "failed",
      updatedAt: new Date().toISOString(),
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
