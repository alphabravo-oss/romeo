import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore, PresignedUpload } from "@romeo/storage";

import type { KnowledgeSource } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import {
  extractUploadedKnowledgeSource,
  type KnowledgeBinaryExtractor,
  type KnowledgeExtractionJobResult,
} from "./knowledge-extraction-worker";
import {
  indexKnowledgeEmbeddings,
  type KnowledgeEmbeddingIndexResult,
} from "./knowledge-embedding-indexing";
import { registerKnowledgeSource } from "./knowledge-source-registration";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import type { QuotaCoordinator } from "./quota-coordination";
import { recordSubjectUsage } from "./record-usage";
import { completeKnowledgeUpload } from "./knowledge-upload-completion";
import type { WebhookEmitter } from "./webhook-service";

export class KnowledgeUploadService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly binaryExtractor: KnowledgeBinaryExtractor,
    private readonly embeddingFetch?: typeof fetch,
    private readonly vectorStore?: KnowledgeVectorStore,
    private readonly quotaCoordinator?: QuotaCoordinator,
    private readonly webhooks?: WebhookEmitter,
  ) {}

  async create(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<{ source: KnowledgeSource; upload: PresignedUpload }> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    return this.repository.transaction(async (repository) => {
      const source = await registerKnowledgeSource(
        repository,
        input.subject,
        knowledgeBase,
        input,
        { quotaCoordinator: this.quotaCoordinator, webhooks: this.webhooks },
      );
      const upload = await this.objectStore.createPresignedUpload({
        key: source.objectKey ?? source.id,
        contentType: source.mimeType,
        expiresInSeconds: 900,
        sizeBytes: source.sizeBytes,
      });
      await recordSubjectUsage(repository, input.subject, {
        orgId: knowledgeBase.orgId,
        workspaceId: knowledgeBase.workspaceId,
        sourceType: "storage",
        sourceId: source.id,
        metric: "storage.source_registered",
        quantity: input.sizeBytes,
        unit: "byte",
        metadata: {
          knowledgeBaseId: knowledgeBase.id,
          mimeType: input.mimeType,
          chunkCount: 0,
          upload: true,
        },
      });
      return { source, upload };
    });
  }

  complete(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeSource> {
    return completeKnowledgeUpload({
      ...input,
      repository: this.repository,
      objectStore: this.objectStore,
      webhooks: this.webhooks,
    });
  }

  extract(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeExtractionJobResult> {
    return extractUploadedKnowledgeSource({
      ...input,
      repository: this.repository,
      objectStore: this.objectStore,
      extractor: this.binaryExtractor,
      webhooks: this.webhooks,
    });
  }

  indexEmbeddings(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    providerId: string;
    model: string;
    batchSize?: number;
  }): Promise<KnowledgeEmbeddingIndexResult> {
    return indexKnowledgeEmbeddings({
      ...input,
      repository: this.repository,
      ...(this.embeddingFetch === undefined
        ? {}
        : { fetchImpl: this.embeddingFetch }),
      ...(this.vectorStore === undefined
        ? {}
        : { vectorStore: this.vectorStore }),
    });
  }
}
