import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { KnowledgeSource } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  canIngestInlineText,
  extractKnowledgeSourceBytes,
} from "./knowledge-ingestion";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { indexKnowledgeSource } from "./knowledge-source-indexing";
import { recordSubjectUsage } from "./record-usage";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";

export async function completeKnowledgeUpload(input: {
  knowledgeBaseId: string;
  objectStore: ObjectStore;
  repository: RomeoRepository;
  sourceId: string;
  subject: AuthSubject;
  webhooks?: WebhookEmitter | undefined;
}): Promise<KnowledgeSource> {
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
  if (!canIngestInlineText(source.mimeType)) {
    throw new ApiError(
      "unsupported_media_type",
      "Upload completion indexing is only available for text knowledge sources.",
      415,
      {
        mimeType: source.mimeType,
      },
    );
  }

  const bytes = await input.objectStore.getObject(source.objectKey);
  if (bytes === undefined)
    throw new ApiError(
      "upload_object_missing",
      "Uploaded object was not found in object storage.",
      409,
    );
  const extracted = extractKnowledgeSourceBytes(bytes, source.mimeType);
  const completed = await input.repository.transaction(async (repository) => {
    const completed = await indexKnowledgeSource(
      repository,
      { ...source, sizeBytes: bytes.byteLength },
      extracted.content,
      { metadata: extracted.metadata },
    );
    await recordSubjectUsage(repository, input.subject, {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
      sourceType: "storage",
      sourceId: source.id,
      metric: "storage.source_completed",
      quantity: bytes.byteLength,
      unit: "byte",
      metadata: {
        knowledgeBaseId: knowledgeBase.id,
        chunkCount: completed.chunkCount ?? 0,
      },
    });
    return completed;
  });
  emitWebhookEvent(input.webhooks, {
    orgId: knowledgeBase.orgId,
    eventType: "knowledge.source.indexed",
    payload: {
      sourceId: completed.id,
      knowledgeBaseId: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      actorId: input.subject.id,
      fileName: completed.fileName,
      mimeType: completed.mimeType,
      sizeBytes: completed.sizeBytes,
      status: completed.status,
      chunkCount: completed.chunkCount ?? 0,
      indexedAt: completed.indexedAt,
    },
  });
  return completed;
}
