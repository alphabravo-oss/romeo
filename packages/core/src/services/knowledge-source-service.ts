import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { KnowledgeBase, KnowledgeSource } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import {
  canIngestInlineText,
  extractInlineKnowledgeContent,
} from "./knowledge-ingestion";
import type { KnowledgeRetrievalPlan } from "./knowledge-retrieval-plan";
import {
  canReadKnowledgeSource,
  filterKnowledgeSourcesForSubject,
} from "./knowledge-source-access";
import { indexKnowledgeSource } from "./knowledge-source-indexing";
import { registerKnowledgeSource } from "./knowledge-source-registration";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import type { QuotaCoordinator } from "./quota-coordination";
import { readRagPolicy } from "./rag-policy-service";
import { recordSubjectUsage } from "./record-usage";
import { ensureSystemAuditActor } from "./system-audit-actor";
import { reportCleanupFailure } from "./telemetry-context";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";

export class KnowledgeSourceService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly vectorStore?: KnowledgeVectorStore,
    private readonly quotaCoordinator?: QuotaCoordinator,
    private readonly webhooks?: WebhookEmitter,
  ) {}

  async list(
    knowledgeBaseId: string,
    subject: AuthSubject,
  ): Promise<KnowledgeSource[]> {
    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
    return filterKnowledgeSourcesForSubject(
      await this.repository.listKnowledgeSources(knowledgeBaseId),
      subject,
    );
  }

  async delete(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeSource> {
    const { knowledgeBase, source } = await this.writableSource(input);
    const [chunks, embeddings, ragPolicy] = await Promise.all([
      this.repository.listKnowledgeChunks(knowledgeBase.id),
      this.repository.listKnowledgeChunkEmbeddings(knowledgeBase.id),
      readRagPolicy(this.repository, knowledgeBase.orgId),
    ]);
    const chunkCount = chunks.filter(
      (chunk) => chunk.sourceId === source.id,
    ).length;
    const embeddingCount = embeddings.filter(
      (embedding) => embedding.sourceId === source.id,
    ).length;
    await this.deleteExternalVectors(knowledgeBase, source);
    if (source.objectKey !== undefined) {
      await this.objectStore.deleteObject(source.objectKey);
    }
    return this.repository.transaction(async (repository) => {
      await repository.deleteKnowledgeChunkEmbeddingsForSource(source.id);
      await repository.deleteKnowledgeChunksForSource(source.id);
      const deleted = await repository.deleteKnowledgeSource(source.id);
      if (!deleted) throw notFound("Knowledge source");
      const metadata = {
        deleteVectorsOnSourceDelete:
          ragPolicy.retention.deleteVectorsOnSourceDelete,
        embeddingCount,
        exportIncludesEmbeddingVectors:
          ragPolicy.retention.exportIncludesEmbeddingVectors,
        knowledgeBaseId: knowledgeBase.id,
        chunkCount,
        objectDeleted: source.objectKey !== undefined,
        ragPolicySource: ragPolicy.source,
      };
      await recordSubjectUsage(repository, input.subject, {
        orgId: knowledgeBase.orgId,
        workspaceId: knowledgeBase.workspaceId,
        sourceType: "storage",
        sourceId: source.id,
        metric: "storage.source_deleted",
        quantity: source.sizeBytes,
        unit: "byte",
        metadata,
      });
      await this.auditDelete(
        input.subject,
        {
          ...metadata,
          sourceId: source.id,
          workspaceId: knowledgeBase.workspaceId,
        },
        repository,
      );
      return deleted;
    });
  }

  async reindex(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
    content: string;
    sizeBytes?: number;
  }): Promise<KnowledgeSource> {
    const { knowledgeBase, source } = await this.writableSource(input);
    if (!canIngestInlineText(source.mimeType)) {
      throw new ApiError(
        "unsupported_media_type",
        "Reindexing inline content is only available for text knowledge sources.",
        415,
        { mimeType: source.mimeType },
      );
    }
    const sizeBytes =
      input.sizeBytes ?? new TextEncoder().encode(input.content).length;
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "worker.enqueue",
      workspaceId: knowledgeBase.workspaceId,
      workerClass: "knowledge.reindex",
    });
    if (sizeBytes > source.sizeBytes) {
      await consumeQuota(
        this.repository,
        input.subject,
        {
          metric: "storage.byte",
          quantity: sizeBytes - source.sizeBytes,
          workspaceId: knowledgeBase.workspaceId,
        },
        { quotaCoordinator: this.quotaCoordinator, webhooks: this.webhooks },
      );
    }
    const job = await startBackgroundJob(this.repository, {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
      type: "knowledge.reindex",
      payload: {
        knowledgeBaseId: knowledgeBase.id,
        sourceId: source.id,
        sizeBytes,
      },
    });
    try {
      const extracted = extractInlineKnowledgeContent(
        input.content,
        source.mimeType,
      );
      const previousObjectBytes =
        source.objectKey === undefined
          ? undefined
          : await this.objectStore.getObject(source.objectKey);
      await this.persistContent(source, input.content);
      const reindexed = await this.repository
        .transaction(async (repository) => {
          const result = await indexKnowledgeSource(
            repository,
            { ...source, sizeBytes },
            extracted.content,
            { metadata: extracted.metadata },
          );
          await recordSubjectUsage(repository, input.subject, {
            orgId: knowledgeBase.orgId,
            workspaceId: knowledgeBase.workspaceId,
            sourceType: "storage",
            sourceId: source.id,
            metric: "storage.source_reindexed",
            quantity: sizeBytes,
            unit: "byte",
            metadata: {
              jobId: job.id,
              knowledgeBaseId: knowledgeBase.id,
              chunkCount: result.chunkCount ?? 0,
              externalVectorDeleteRequested: this.vectorStore !== undefined,
            },
          });
          await completeBackgroundJob(repository, job);
          return result;
        })
        .catch(async (error: unknown) => {
          if (source.objectKey !== undefined) {
            await this.restoreContent(source, previousObjectBytes);
          }
          throw error;
        });
      await this.deleteExternalVectors(knowledgeBase, source);
      this.emitIndexed(input.subject.id, knowledgeBase, reindexed);
      return reindexed;
    } catch (error) {
      await failBackgroundJob(
        this.repository,
        job,
        error instanceof Error ? error.constructor.name : "unknown_error",
      );
      throw error;
    }
  }

  async create(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    fileName: string;
    metadata?: Record<string, unknown>;
    mimeType: string;
    sizeBytes: number;
    content?: string;
  }): Promise<KnowledgeSource> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    if (input.content !== undefined && !canIngestInlineText(input.mimeType)) {
      throw new ApiError(
        "unsupported_media_type",
        "Inline ingestion is only available for text knowledge sources.",
        415,
        { mimeType: input.mimeType },
      );
    }
    const extracted =
      input.content === undefined
        ? undefined
        : extractInlineKnowledgeContent(input.content, input.mimeType);
    let objectKey: string | undefined;
    const indexedSource = await this.repository
      .transaction(async (repository) => {
        const source = await registerKnowledgeSource(
          repository,
          input.subject,
          knowledgeBase,
          input,
          { quotaCoordinator: this.quotaCoordinator, webhooks: this.webhooks },
        );
        objectKey = source.objectKey;
        if (input.content !== undefined) {
          await this.persistContent(source, input.content);
        }
        const indexed =
          extracted === undefined
            ? source
            : await indexKnowledgeSource(
                repository,
                source,
                extracted.content,
                { metadata: extracted.metadata },
              );
        await recordSubjectUsage(repository, input.subject, {
          orgId: knowledgeBase.orgId,
          workspaceId: knowledgeBase.workspaceId,
          sourceType: "storage",
          sourceId: indexed.id,
          metric: "storage.source_registered",
          quantity: input.sizeBytes,
          unit: "byte",
          metadata: {
            knowledgeBaseId: knowledgeBase.id,
            mimeType: input.mimeType,
            chunkCount: indexed.chunkCount ?? 0,
          },
        });
        return indexed;
      })
      .catch(async (error: unknown) => {
        if (objectKey !== undefined) await this.deleteObjectKey(objectKey);
        throw error;
      });
    if (indexedSource.status === "indexed") {
      this.emitIndexed(input.subject.id, knowledgeBase, indexedSource);
    }
    return indexedSource;
  }

  private async writableSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<{ knowledgeBase: KnowledgeBase; source: KnowledgeSource }> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    const source = (
      await this.repository.listKnowledgeSources(knowledgeBase.id)
    ).find((item) => item.id === input.sourceId);
    if (!source || !canReadKnowledgeSource(source, input.subject)) {
      throw notFound("Knowledge source");
    }
    return { knowledgeBase, source };
  }

  private async auditDelete(
    subject: AuthSubject,
    metadata: {
      chunkCount: number;
      deleteVectorsOnSourceDelete: boolean;
      embeddingCount: number;
      exportIncludesEmbeddingVectors: boolean;
      knowledgeBaseId: string;
      objectDeleted: boolean;
      ragPolicySource: KnowledgeRetrievalPlan["policy"]["source"];
      sourceId: string;
      workspaceId: string;
    },
    repository: RomeoRepository,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(repository, {
              kind: "service_account_knowledge_retention",
              name: "Service Account Knowledge Retention Audit",
              orgId: subject.orgId,
            })
          ).id;
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action: "knowledge.source.delete",
      resourceType: "knowledge_source",
      resourceId: metadata.sourceId,
      outcome: "success",
      metadata: {
        actorSubjectType: subject.type,
        ...metadata,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private deleteExternalVectors(
    knowledgeBase: KnowledgeBase,
    source: KnowledgeSource,
  ): Promise<void> | undefined {
    return this.vectorStore?.deleteEmbeddingsForSource({
      knowledgeBaseId: knowledgeBase.id,
      orgId: knowledgeBase.orgId,
      sourceId: source.id,
      workspaceId: knowledgeBase.workspaceId,
    });
  }

  private async persistContent(source: KnowledgeSource, content: string) {
    if (source.objectKey === undefined) return;
    await this.objectStore.putObject({
      key: source.objectKey,
      body: new TextEncoder().encode(content),
      contentType: source.mimeType,
    });
  }

  private async deleteObjectKey(objectKey: string) {
    try {
      await this.objectStore.deleteObject(objectKey);
    } catch {
      reportCleanupFailure("knowledge_source.delete_object");
      // Object-store lifecycle expiry is the fallback for cleanup failures.
    }
  }

  private async restoreContent(
    source: KnowledgeSource,
    previousBytes: Uint8Array | undefined,
  ) {
    if (source.objectKey === undefined) return;
    try {
      if (previousBytes === undefined) {
        await this.objectStore.deleteObject(source.objectKey);
      } else {
        await this.objectStore.putObject({
          key: source.objectKey,
          body: previousBytes,
          contentType: source.mimeType,
        });
      }
    } catch {
      reportCleanupFailure("knowledge_source.restore_content");
      // A later retry can repair object-store content if rollback fails.
    }
  }

  private emitIndexed(
    actorId: string,
    knowledgeBase: KnowledgeBase,
    source: KnowledgeSource,
  ) {
    emitWebhookEvent(this.webhooks, {
      orgId: knowledgeBase.orgId,
      eventType: "knowledge.source.indexed",
      payload: {
        sourceId: source.id,
        knowledgeBaseId: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        actorId,
        fileName: source.fileName,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        status: source.status,
        chunkCount: source.chunkCount ?? 0,
        indexedAt: source.indexedAt,
      },
    });
  }
}
