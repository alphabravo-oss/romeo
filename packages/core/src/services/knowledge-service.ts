import {
  disabledRagProvider,
  type RagProvider,
  type RetrievalHit,
} from "@romeo/rag";
import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  memoryObjectStore,
  type ObjectStore,
  type PresignedUpload,
} from "@romeo/storage";

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
import {
  assertKnowledgeWorkspaceAccess,
  createKnowledgeOwnerGrants,
  getAuthorizedKnowledgeBase,
} from "./knowledge-access";
import {
  disabledKnowledgeBinaryExtractor,
  extractUploadedKnowledgeSource,
  type KnowledgeBinaryExtractor,
  type KnowledgeExtractionJobResult,
} from "./knowledge-extraction-worker";
import {
  canIngestInlineText,
  extractInlineKnowledgeContent,
} from "./knowledge-ingestion";
import {
  indexKnowledgeEmbeddings,
  type KnowledgeEmbeddingIndexResult,
} from "./knowledge-embedding-indexing";
import {
  compileKnowledgeRetrievalPlan,
  defaultRetrievalPosture,
  type KnowledgeRetrievalPlan,
  type KnowledgeRetrievalPlanEntry,
  type KnowledgeRetrievalPosture,
  type KnowledgeRetrievalTier,
} from "./knowledge-retrieval-plan";
import {
  lexicalRetrievalRoute,
  type KnowledgeRetrievalRoute,
} from "./knowledge-retrieval-route";
import {
  canReadKnowledgeSource,
  filterKnowledgeChunksForSources,
  filterKnowledgeSourcesForSubject,
} from "./knowledge-source-access";
import { indexKnowledgeSource } from "./knowledge-source-indexing";
import { registerKnowledgeSource } from "./knowledge-source-registration";
import type { QuotaCoordinator } from "./quota-coordination";
import { completeKnowledgeUpload } from "./knowledge-upload-completion";
import { retrievePersistedVectorHitsWithRoute } from "./knowledge-vector-retrieval";
import { readRagPolicy } from "./rag-policy-service";
import { recordSubjectUsage } from "./record-usage";
import { ensureSystemAuditActor } from "./system-audit-actor";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import { assertWorkspaceActive } from "./workspace-guard";

export interface TieredRetrievalHit extends RetrievalHit {
  knowledgeBaseId: string;
  orgId: string;
  permissionReason: KnowledgeRetrievalPlanEntry["permissionReason"];
  retrievalRoute: KnowledgeRetrievalRoute;
  tier: KnowledgeRetrievalTier;
  workspaceId: string;
}

export interface TieredKnowledgeQueryResult {
  hits: TieredRetrievalHit[];
  plan: KnowledgeRetrievalPlan;
}

export interface KnowledgeRetrievalReplayCaseInput {
  id?: string;
  expectedChunkIds?: string[];
  knowledgeBaseIds: string[];
  maxResultsPerTier?: Partial<
    Record<KnowledgeRetrievalTier, number | undefined>
  >;
  query: string;
}

export interface KnowledgeRetrievalReplayCaseResult {
  authorizedKnowledgeBaseCount: number;
  caseId?: string;
  expectedChunkCount: number;
  fallbackReasons: Partial<
    Record<NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>, number>
  >;
  hitCount: number;
  latencyMs: number;
  matchedExpectedChunkCount: number;
  precision: number | null;
  recall: number | null;
  retrievalRouteModes: Record<KnowledgeRetrievalRoute["mode"], number>;
  skippedKnowledgeBaseCount: number;
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayReport {
  caseCount: number;
  cases: KnowledgeRetrievalReplayCaseResult[];
  generatedAt: string;
  metrics: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  orgId: string;
  redaction: {
    rawQueriesReturned: false;
    rawChunkTextReturned: false;
    rawExpectedChunkIdsReturned: false;
    rawHitIdsReturned: false;
    vectorValuesReturned: false;
  };
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayComparisonReport {
  baseline: KnowledgeRetrievalReplayReport;
  candidate: KnowledgeRetrievalReplayReport;
  deltas: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  generatedAt: string;
  orgId: string;
  outcome: "improved" | "observed" | "regressed" | "unchanged";
  redaction: {
    rawQueriesReturned: false;
    rawChunkTextReturned: false;
    rawExpectedChunkIdsReturned: false;
    rawHitIdsReturned: false;
    vectorValuesReturned: false;
  };
}

export class KnowledgeService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly ragProvider: RagProvider = disabledRagProvider,
    private readonly objectStore: ObjectStore = memoryObjectStore,
    private readonly binaryExtractor: KnowledgeBinaryExtractor = disabledKnowledgeBinaryExtractor,
    private readonly embeddingFetch?: typeof fetch,
    private readonly webhooks?: WebhookEmitter,
    private readonly retrievalPosture: KnowledgeRetrievalPosture = defaultRetrievalPosture(),
    private readonly vectorStore?: KnowledgeVectorStore,
    private readonly quotaCoordinator?: QuotaCoordinator,
  ) {}

  async list(
    workspaceId: string,
    subject: AuthSubject,
  ): Promise<KnowledgeBase[]> {
    assertKnowledgeWorkspaceAccess(subject, workspaceId, "knowledge:read");
    return (await this.repository.listKnowledgeBases(workspaceId)).filter(
      (knowledgeBase) => canAccessOrg(subject, knowledgeBase.orgId),
    );
  }

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    name: string;
    description?: string;
  }): Promise<KnowledgeBase> {
    assertKnowledgeWorkspaceAccess(
      input.subject,
      input.workspaceId,
      "knowledge:write",
    );
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });

    return this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const createdBy = await knowledgeBaseCreatorId(repository, input.subject);
      const draft: KnowledgeBase = {
        id: createId("kb"),
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
        name: input.name,
        createdBy,
        createdAt: now,
        updatedAt: now,
      };
      if (input.description !== undefined)
        draft.description = input.description;

      const knowledgeBase = await repository.createKnowledgeBase(draft);

      await createKnowledgeOwnerGrants(
        repository,
        input.subject,
        knowledgeBase.id,
      );
      await this.auditKnowledgeBase(
        input.subject,
        "knowledge_base.create",
        {
          knowledgeBaseId: knowledgeBase.id,
          workspaceId: knowledgeBase.workspaceId,
          descriptionConfigured: knowledgeBase.description !== undefined,
        },
        repository,
      );
      return knowledgeBase;
    });
  }

  async get(
    knowledgeBaseId: string,
    subject: AuthSubject,
  ): Promise<KnowledgeBase> {
    return getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
  }

  async update(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    name?: string;
    description?: string | null;
  }): Promise<KnowledgeBase> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
    });

    const changedFields: string[] = [];
    const next: KnowledgeBase = {
      ...knowledgeBase,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new ApiError(
          "invalid_knowledge_base_update",
          "A non-empty knowledge base name is required.",
          400,
        );
      }
      next.name = name;
      if (name !== knowledgeBase.name) changedFields.push("name");
    }
    if (input.description !== undefined) {
      const description = input.description?.trim() ?? "";
      if (description.length > 0) next.description = description;
      else delete next.description;
      if (next.description !== knowledgeBase.description)
        changedFields.push("description");
    }
    if (changedFields.length === 0) return knowledgeBase;

    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateKnowledgeBase(next);
      await this.auditKnowledgeBase(
        input.subject,
        "knowledge_base.update",
        {
          knowledgeBaseId: updated.id,
          workspaceId: updated.workspaceId,
          changedFields,
          descriptionConfigured: updated.description !== undefined,
        },
        repository,
      );
      return updated;
    });
  }

  async listSources(
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

  async deleteSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeSource> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    const source = (
      await this.repository.listKnowledgeSources(knowledgeBase.id)
    ).find((item) => item.id === input.sourceId);
    if (!source) throw notFound("Knowledge source");
    if (!canReadKnowledgeSource(source, input.subject))
      throw notFound("Knowledge source");

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

    await this.deleteExternalVectorsForSource(knowledgeBase, source);
    if (source.objectKey !== undefined)
      await this.objectStore.deleteObject(source.objectKey);
    return this.repository.transaction(async (repository) => {
      await repository.deleteKnowledgeChunkEmbeddingsForSource(source.id);
      await repository.deleteKnowledgeChunksForSource(source.id);
      const deleted = await repository.deleteKnowledgeSource(source.id);
      if (!deleted) throw notFound("Knowledge source");
      await recordSubjectUsage(repository, input.subject, {
        orgId: knowledgeBase.orgId,
        workspaceId: knowledgeBase.workspaceId,
        sourceType: "storage",
        sourceId: source.id,
        metric: "storage.source_deleted",
        quantity: source.sizeBytes,
        unit: "byte",
        metadata: {
          deleteVectorsOnSourceDelete:
            ragPolicy.retention.deleteVectorsOnSourceDelete,
          embeddingCount,
          exportIncludesEmbeddingVectors:
            ragPolicy.retention.exportIncludesEmbeddingVectors,
          knowledgeBaseId: knowledgeBase.id,
          chunkCount,
          objectDeleted: source.objectKey !== undefined,
          ragPolicySource: ragPolicy.source,
        },
      });
      await this.auditKnowledgeSourceDelete(
        input.subject,
        {
          chunkCount,
          deleteVectorsOnSourceDelete:
            ragPolicy.retention.deleteVectorsOnSourceDelete,
          embeddingCount,
          exportIncludesEmbeddingVectors:
            ragPolicy.retention.exportIncludesEmbeddingVectors,
          knowledgeBaseId: knowledgeBase.id,
          objectDeleted: source.objectKey !== undefined,
          ragPolicySource: ragPolicy.source,
          sourceId: source.id,
          workspaceId: knowledgeBase.workspaceId,
        },
        repository,
      );
      return deleted;
    });
  }

  async reindexSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
    content: string;
    sizeBytes?: number;
  }): Promise<KnowledgeSource> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    const source = (
      await this.repository.listKnowledgeSources(knowledgeBase.id)
    ).find((item) => item.id === input.sourceId);
    if (!source) throw notFound("Knowledge source");
    if (!canReadKnowledgeSource(source, input.subject))
      throw notFound("Knowledge source");
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
      let contentPersisted = false;
      await this.persistSourceContent(source, input.content);
      contentPersisted = source.objectKey !== undefined;
      const reindexed = await this.repository
        .transaction(async (repository) => {
          const reindexed = await indexKnowledgeSource(
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
              chunkCount: reindexed.chunkCount ?? 0,
              externalVectorDeleteRequested: this.vectorStore !== undefined,
            },
          });
          await completeBackgroundJob(repository, job);
          return reindexed;
        })
        .catch(async (error: unknown) => {
          if (contentPersisted && source.objectKey !== undefined) {
            await this.restoreSourceContent(source, previousObjectBytes);
          }
          throw error;
        });
      await this.deleteExternalVectorsForSource(knowledgeBase, source);
      this.emitKnowledgeIndexed(input.subject.id, knowledgeBase, reindexed);
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

  async createSource(input: {
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
      input.content !== undefined
        ? extractInlineKnowledgeContent(input.content, input.mimeType)
        : undefined;
    let objectKey: string | undefined;
    const indexedSource = await this.repository
      .transaction(async (repository) => {
        const source = await registerKnowledgeSource(
          repository,
          input.subject,
          knowledgeBase,
          input,
          {
            quotaCoordinator: this.quotaCoordinator,
            webhooks: this.webhooks,
          },
        );
        objectKey = source.objectKey;
        if (input.content !== undefined)
          await this.persistSourceContent(source, input.content);
        const indexedSource = extracted
          ? await indexKnowledgeSource(repository, source, extracted.content, {
              metadata: extracted.metadata,
            })
          : source;

        await recordSubjectUsage(repository, input.subject, {
          orgId: knowledgeBase.orgId,
          workspaceId: knowledgeBase.workspaceId,
          sourceType: "storage",
          sourceId: indexedSource.id,
          metric: "storage.source_registered",
          quantity: input.sizeBytes,
          unit: "byte",
          metadata: {
            knowledgeBaseId: knowledgeBase.id,
            mimeType: input.mimeType,
            chunkCount: indexedSource.chunkCount ?? 0,
          },
        });
        return indexedSource;
      })
      .catch(async (error: unknown) => {
        if (objectKey !== undefined) await this.deleteObjectKey(objectKey);
        throw error;
      });
    if (indexedSource.status === "indexed")
      this.emitKnowledgeIndexed(input.subject.id, knowledgeBase, indexedSource);
    return indexedSource;
  }

  async createUpload(input: {
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
    const { source, upload } = await this.repository.transaction(
      async (repository) => {
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
      },
    );
    return { source, upload };
  }

  async completeUpload(input: {
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

  async extractUpload(input: {
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

  async indexEmbeddings(input: {
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

  async query(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    query: string;
    maxResults?: number;
  }): Promise<RetrievalHit[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:query",
      permission: "use",
    });
    return this.queryAuthorizedKnowledgeBase({
      subject: input.subject,
      knowledgeBase,
      query: input.query,
      ...(input.maxResults === undefined
        ? {}
        : { maxResults: input.maxResults }),
    });
  }

  async queryTiered(input: {
    subject: AuthSubject;
    knowledgeBaseIds: string[];
    query: string;
    maxResultsPerTier?: Partial<
      Record<KnowledgeRetrievalTier, number | undefined>
    >;
  }): Promise<TieredKnowledgeQueryResult> {
    const startedAt = Date.now();
    const plan = await compileKnowledgeRetrievalPlan(this.repository, {
      subject: input.subject,
      knowledgeBaseIds: input.knowledgeBaseIds,
      ...(input.maxResultsPerTier === undefined
        ? {}
        : { maxResultsPerTier: input.maxResultsPerTier }),
      posture: this.retrievalPosture,
    });
    const groupedResults = await Promise.all(
      plan.entries.map(async (entry) => {
        const knowledgeBase = await this.repository.getKnowledgeBase(
          entry.knowledgeBaseId,
        );
        if (knowledgeBase === undefined) {
          return {
            entry,
            hits: [],
            route: lexicalRetrievalRoute("no_visible_chunks"),
          };
        }
        const result = await this.queryAuthorizedKnowledgeBaseWithRoute({
          subject: input.subject,
          knowledgeBase,
          query: input.query,
          maxResults: entry.maxResults,
        });
        return {
          entry,
          route: result.route,
          hits: result.hits.map(
            (hit): TieredRetrievalHit => ({
              ...hit,
              knowledgeBaseId: entry.knowledgeBaseId,
              orgId: entry.orgId,
              permissionReason: entry.permissionReason,
              retrievalRoute: result.route,
              tier: entry.tier,
              workspaceId: entry.workspaceId,
            }),
          ),
        };
      }),
    );
    const routeByKnowledgeBaseId = new Map(
      groupedResults.map((result) => [
        result.entry.knowledgeBaseId,
        result.route,
      ]),
    );
    const enrichedPlan: KnowledgeRetrievalPlan = {
      ...plan,
      entries: plan.entries.map((entry) => ({
        ...entry,
        retrievalRoute:
          routeByKnowledgeBaseId.get(entry.knowledgeBaseId) ??
          lexicalRetrievalRoute("no_visible_chunks"),
      })),
    };
    const hits = groupedResults.flatMap((result) => result.hits);
    await this.auditTieredQuery(
      input.subject,
      enrichedPlan,
      hits,
      Date.now() - startedAt,
    );
    return { plan: enrichedPlan, hits };
  }

  async replayTiered(input: {
    subject: AuthSubject;
    cases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayReport> {
    assertScope(input.subject, "admin:read");
    const report = await this.runTieredReplayCases(input.subject, input.cases);
    await this.auditTieredReplay(input.subject, report);
    return report;
  }

  async compareTieredReplay(input: {
    subject: AuthSubject;
    baselineCases: KnowledgeRetrievalReplayCaseInput[];
    candidateCases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayComparisonReport> {
    assertScope(input.subject, "admin:read");
    const baseline = await this.runTieredReplayCases(
      input.subject,
      input.baselineCases,
    );
    const candidate = await this.runTieredReplayCases(
      input.subject,
      input.candidateCases,
    );
    const report = buildReplayComparisonReport(
      input.subject.orgId,
      baseline,
      candidate,
    );
    await this.auditTieredReplayComparison(input.subject, report);
    return report;
  }

  private async runTieredReplayCases(
    subject: AuthSubject,
    replayCases: KnowledgeRetrievalReplayCaseInput[],
  ): Promise<KnowledgeRetrievalReplayReport> {
    if (replayCases.length === 0) {
      throw new ApiError(
        "knowledge_replay_empty",
        "Retrieval replay requires at least one case.",
        400,
      );
    }
    const cases: KnowledgeRetrievalReplayCaseResult[] = [];
    for (const replayCase of replayCases) {
      const startedAt = Date.now();
      const result = await this.queryTiered({
        subject,
        knowledgeBaseIds: replayCase.knowledgeBaseIds,
        query: replayCase.query,
        ...(replayCase.maxResultsPerTier === undefined
          ? {}
          : { maxResultsPerTier: replayCase.maxResultsPerTier }),
      });
      cases.push(
        scoreReplayCase(
          replayCase,
          result,
          Math.max(0, Date.now() - startedAt),
        ),
      );
    }
    return buildReplayReport(subject.orgId, cases);
  }

  private async queryAuthorizedKnowledgeBase(input: {
    subject: AuthSubject;
    knowledgeBase: KnowledgeBase;
    query: string;
    maxResults?: number;
  }): Promise<RetrievalHit[]> {
    return (await this.queryAuthorizedKnowledgeBaseWithRoute(input)).hits;
  }

  private async queryAuthorizedKnowledgeBaseWithRoute(input: {
    subject: AuthSubject;
    knowledgeBase: KnowledgeBase;
    query: string;
    maxResults?: number;
  }): Promise<{ hits: RetrievalHit[]; route: KnowledgeRetrievalRoute }> {
    const knowledgeBase = input.knowledgeBase;
    const [sources, chunks] = await Promise.all([
      this.repository.listKnowledgeSources(knowledgeBase.id),
      this.repository.listKnowledgeChunks(knowledgeBase.id),
    ]);
    const visibleSources = filterKnowledgeSourcesForSubject(
      sources,
      input.subject,
    );
    const visibleChunks = filterKnowledgeChunksForSources(
      chunks,
      visibleSources,
    );
    if (visibleChunks.length > 0) {
      return retrievePersistedVectorHitsWithRoute({
        repository: this.repository,
        subject: input.subject,
        knowledgeBase,
        chunks: visibleChunks,
        sources: visibleSources,
        query: input.query,
        ...(input.maxResults === undefined
          ? {}
          : { maxResults: input.maxResults }),
        ...(this.embeddingFetch === undefined
          ? {}
          : { fetchImpl: this.embeddingFetch }),
        ...(this.vectorStore === undefined
          ? {}
          : { vectorStore: this.vectorStore }),
      });
    }

    const query = {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
      query: input.query,
    };
    if (input.maxResults !== undefined)
      Object.assign(query, { maxResults: input.maxResults });
    return {
      hits: await this.ragProvider.retrieve(query),
      route: {
        mode: "legacy_rag_provider",
        vectorStoreDriver: "none",
        externalVectorStoreAttempted: false,
        externalVectorStoreUsed: false,
        fallbackReason: "no_visible_chunks",
      },
    };
  }

  private async auditTieredQuery(
    subject: AuthSubject,
    plan: KnowledgeRetrievalPlan,
    hits: TieredRetrievalHit[],
    latencyMs: number,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(this.repository, {
              kind: "service_account_retrieval",
              name: "Service Account Retrieval Audit",
              orgId: subject.orgId,
            })
          ).id;
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action: "knowledge.query.tiered",
      resourceType: "knowledge_retrieval_plan",
      resourceId: "tiered_query",
      outcome: "success",
      metadata: {
        actorSubjectType: subject.type,
        authorizedCount: plan.authorizedCount,
        externalVectorStoreConfigured:
          plan.posture.externalVectorStoreConfigured,
        externalVectorStoreDriver: plan.posture.externalVectorStoreDriver,
        externalVectorStoreRoutingActive:
          plan.posture.externalVectorStoreRoutingActive,
        isolationMode: plan.posture.isolationMode,
        knowledgeBaseIds: plan.entries.map((entry) => entry.knowledgeBaseId),
        latencyMs,
        namespaceConfigured: plan.posture.namespaceConfigured,
        namespacePolicy: plan.posture.namespacePolicy,
        partitioningConfigured: plan.posture.partitioningConfigured,
        partitioningPolicy: plan.posture.partitioningPolicy,
        ragPolicyEnabledTiers: plan.policy.enabledTiers,
        ragPolicySource: plan.policy.source,
        requestedCount: plan.requestedCount,
        retrievalFallbackReasons: routeFallbackReasonCounts(plan.entries),
        retrievalRouteModes: routeModeCounts(plan.entries),
        resultCountsByTier: tierHitCounts(hits),
        skipped: plan.skipped,
        tierCounts: tierEntryCounts(plan.entries),
        vectorDriver: plan.posture.vectorDriver,
        vectorEmbeddingModels: vectorEmbeddingModels(plan.entries),
        vectorProviderIds: vectorProviderIds(plan.entries),
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private async auditKnowledgeBase(
    subject: AuthSubject,
    action: string,
    metadata: {
      changedFields?: string[];
      descriptionConfigured: boolean;
      knowledgeBaseId: string;
      workspaceId: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(repository, {
              kind: "service_account_knowledge_base",
              name: "Service Account Knowledge Base Audit",
              orgId: subject.orgId,
            })
          ).id;
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action,
      resourceType: "knowledge_base",
      resourceId: metadata.knowledgeBaseId,
      outcome: "success",
      metadata: {
        actorSubjectType: subject.type,
        descriptionConfigured: metadata.descriptionConfigured,
        ...(metadata.changedFields === undefined
          ? {}
          : { changedFields: metadata.changedFields }),
        workspaceId: metadata.workspaceId,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private async auditTieredReplay(
    subject: AuthSubject,
    report: KnowledgeRetrievalReplayReport,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(this.repository, {
              kind: "service_account_retrieval",
              name: "Service Account Retrieval Audit",
              orgId: subject.orgId,
            })
          ).id;
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action: "knowledge.replay.tiered",
      resourceType: "knowledge_retrieval_replay",
      resourceId: "tiered_replay",
      outcome: "success",
      metadata: {
        averageLatencyMs: report.metrics.averageLatencyMs,
        caseCount: report.caseCount,
        expectedChunkCount: report.metrics.expectedChunkCount,
        hitCount: report.metrics.hitCount,
        matchedExpectedChunkCount: report.metrics.matchedExpectedChunkCount,
        status: report.status,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: report.generatedAt,
    });
  }

  private async auditTieredReplayComparison(
    subject: AuthSubject,
    report: KnowledgeRetrievalReplayComparisonReport,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(this.repository, {
              kind: "service_account_retrieval",
              name: "Service Account Retrieval Audit",
              orgId: subject.orgId,
            })
          ).id;
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action: "knowledge.replay.compare",
      resourceType: "knowledge_retrieval_replay",
      resourceId: "tiered_replay_compare",
      outcome: "success",
      metadata: {
        baseline: replayAuditMetadata(report.baseline),
        candidate: replayAuditMetadata(report.candidate),
        deltas: report.deltas,
        outcome: report.outcome,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: report.generatedAt,
    });
  }

  private async auditKnowledgeSourceDelete(
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
    repository: RomeoRepository = this.repository,
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
        chunkCount: metadata.chunkCount,
        deleteVectorsOnSourceDelete: metadata.deleteVectorsOnSourceDelete,
        embeddingCount: metadata.embeddingCount,
        exportIncludesEmbeddingVectors: metadata.exportIncludesEmbeddingVectors,
        knowledgeBaseId: metadata.knowledgeBaseId,
        objectDeleted: metadata.objectDeleted,
        ragPolicySource: metadata.ragPolicySource,
        workspaceId: metadata.workspaceId,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private async deleteExternalVectorsForSource(
    knowledgeBase: KnowledgeBase,
    source: KnowledgeSource,
  ): Promise<void> {
    await this.vectorStore?.deleteEmbeddingsForSource({
      knowledgeBaseId: knowledgeBase.id,
      orgId: knowledgeBase.orgId,
      sourceId: source.id,
      workspaceId: knowledgeBase.workspaceId,
    });
  }

  private async persistSourceContent(
    source: KnowledgeSource,
    content: string,
  ): Promise<void> {
    if (source.objectKey === undefined) return;
    await this.objectStore.putObject({
      key: source.objectKey,
      body: new TextEncoder().encode(content),
      contentType: source.mimeType,
    });
  }

  private async deleteObjectKey(objectKey: string): Promise<void> {
    try {
      await this.objectStore.deleteObject(objectKey);
    } catch {
      // Object-store lifecycle expiry is the fallback for cleanup failures.
    }
  }

  private async restoreSourceContent(
    source: KnowledgeSource,
    previousBytes: Uint8Array | undefined,
  ): Promise<void> {
    if (source.objectKey === undefined) return;
    try {
      if (previousBytes === undefined) {
        await this.objectStore.deleteObject(source.objectKey);
        return;
      }
      await this.objectStore.putObject({
        key: source.objectKey,
        body: previousBytes,
        contentType: source.mimeType,
      });
    } catch {
      // A later reindex retry can repair object-store content if rollback restore fails.
    }
  }

  private emitKnowledgeIndexed(
    actorId: string,
    knowledgeBase: KnowledgeBase,
    source: KnowledgeSource,
  ): void {
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

function tierEntryCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Record<KnowledgeRetrievalTier, number> {
  const counts = emptyTierCounts();
  for (const entry of entries) counts[entry.tier] += 1;
  return counts;
}

function tierHitCounts(
  hits: TieredRetrievalHit[],
): Record<KnowledgeRetrievalTier, number> {
  const counts = emptyTierCounts();
  for (const hit of hits) counts[hit.tier] += 1;
  return counts;
}

function routeModeCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Record<KnowledgeRetrievalRoute["mode"], number> {
  const counts: Record<KnowledgeRetrievalRoute["mode"], number> = {
    external_vector: 0,
    legacy_rag_provider: 0,
    lexical_fallback: 0,
    pgvector: 0,
  };
  for (const entry of entries) {
    const mode = entry.retrievalRoute?.mode;
    if (mode !== undefined) counts[mode] += 1;
  }
  return counts;
}

function routeFallbackReasonCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Partial<
  Record<NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>, number>
> {
  const counts = new Map<
    NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>,
    number
  >();
  for (const entry of entries) {
    const reason = entry.retrievalRoute?.fallbackReason;
    if (reason === undefined) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries(counts.entries());
}

function vectorProviderIds(entries: KnowledgeRetrievalPlanEntry[]): string[] {
  return uniqueSorted(
    entries.flatMap((entry) =>
      entry.retrievalRoute?.providerId === undefined
        ? []
        : [entry.retrievalRoute.providerId],
    ),
  );
}

function vectorEmbeddingModels(
  entries: KnowledgeRetrievalPlanEntry[],
): string[] {
  return uniqueSorted(
    entries.flatMap((entry) =>
      entry.retrievalRoute?.embeddingModel === undefined
        ? []
        : [entry.retrievalRoute.embeddingModel],
    ),
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function knowledgeBaseCreatorId(
  repository: RomeoRepository,
  subject: AuthSubject,
): Promise<string> {
  return persistedSubjectActorId(repository, subject, {
    kind: "service_account_knowledge_owner",
    name: "Service Account Knowledge Owner",
  });
}

function emptyTierCounts(): Record<KnowledgeRetrievalTier, number> {
  return {
    user_private: 0,
    workspace: 0,
    org: 0,
    shared: 0,
  };
}

function scoreReplayCase(
  replayCase: KnowledgeRetrievalReplayCaseInput,
  result: TieredKnowledgeQueryResult,
  latencyMs: number,
): KnowledgeRetrievalReplayCaseResult {
  const expectedChunkIds = new Set(replayCase.expectedChunkIds ?? []);
  const hitChunkIds = result.hits.map((hit) => hit.citation.chunkId);
  const matchedExpectedChunkCount = [...expectedChunkIds].filter((chunkId) =>
    hitChunkIds.includes(chunkId),
  ).length;
  const precision =
    expectedChunkIds.size === 0
      ? null
      : hitChunkIds.length === 0
        ? 0
        : matchedExpectedChunkCount / hitChunkIds.length;
  const recall =
    expectedChunkIds.size === 0
      ? null
      : matchedExpectedChunkCount / expectedChunkIds.size;
  return {
    authorizedKnowledgeBaseCount: result.plan.authorizedCount,
    expectedChunkCount: expectedChunkIds.size,
    fallbackReasons: routeFallbackReasonCounts(result.plan.entries),
    hitCount: result.hits.length,
    latencyMs,
    matchedExpectedChunkCount,
    precision,
    recall,
    retrievalRouteModes: routeModeCounts(result.plan.entries),
    skippedKnowledgeBaseCount: result.plan.skipped.count,
    status:
      expectedChunkIds.size === 0
        ? "observed"
        : matchedExpectedChunkCount === expectedChunkIds.size
          ? "passed"
          : "failed",
    ...(replayCase.id === undefined ? {} : { caseId: replayCase.id }),
  };
}

function buildReplayReport(
  orgId: string,
  cases: KnowledgeRetrievalReplayCaseResult[],
): KnowledgeRetrievalReplayReport {
  const expectedCases = cases.filter((testCase) => testCase.recall !== null);
  const status =
    expectedCases.length === 0
      ? "observed"
      : cases.some((testCase) => testCase.status === "failed")
        ? "failed"
        : "passed";
  return {
    caseCount: cases.length,
    cases,
    generatedAt: new Date().toISOString(),
    metrics: {
      averageLatencyMs:
        average(cases.map((testCase) => testCase.latencyMs)) ?? 0,
      averagePrecision: average(
        expectedCases.flatMap((testCase) =>
          testCase.precision === null ? [] : [testCase.precision],
        ),
      ),
      averageRecall: average(
        expectedCases.flatMap((testCase) =>
          testCase.recall === null ? [] : [testCase.recall],
        ),
      ),
      expectedChunkCount: cases.reduce(
        (total, testCase) => total + testCase.expectedChunkCount,
        0,
      ),
      hitCount: cases.reduce((total, testCase) => total + testCase.hitCount, 0),
      matchedExpectedChunkCount: cases.reduce(
        (total, testCase) => total + testCase.matchedExpectedChunkCount,
        0,
      ),
    },
    orgId,
    redaction: {
      rawChunkTextReturned: false,
      rawExpectedChunkIdsReturned: false,
      rawHitIdsReturned: false,
      rawQueriesReturned: false,
      vectorValuesReturned: false,
    },
    status,
  };
}

function buildReplayComparisonReport(
  orgId: string,
  baseline: KnowledgeRetrievalReplayReport,
  candidate: KnowledgeRetrievalReplayReport,
): KnowledgeRetrievalReplayComparisonReport {
  const deltas = {
    averageLatencyMs:
      candidate.metrics.averageLatencyMs - baseline.metrics.averageLatencyMs,
    averagePrecision: nullableDelta(
      baseline.metrics.averagePrecision,
      candidate.metrics.averagePrecision,
    ),
    averageRecall: nullableDelta(
      baseline.metrics.averageRecall,
      candidate.metrics.averageRecall,
    ),
    expectedChunkCount:
      candidate.metrics.expectedChunkCount -
      baseline.metrics.expectedChunkCount,
    hitCount: candidate.metrics.hitCount - baseline.metrics.hitCount,
    matchedExpectedChunkCount:
      candidate.metrics.matchedExpectedChunkCount -
      baseline.metrics.matchedExpectedChunkCount,
  };
  return {
    baseline,
    candidate,
    deltas,
    generatedAt: new Date().toISOString(),
    orgId,
    outcome: replayComparisonOutcome(baseline, candidate, deltas),
    redaction: {
      rawChunkTextReturned: false,
      rawExpectedChunkIdsReturned: false,
      rawHitIdsReturned: false,
      rawQueriesReturned: false,
      vectorValuesReturned: false,
    },
  };
}

function replayComparisonOutcome(
  baseline: KnowledgeRetrievalReplayReport,
  candidate: KnowledgeRetrievalReplayReport,
  deltas: KnowledgeRetrievalReplayComparisonReport["deltas"],
): KnowledgeRetrievalReplayComparisonReport["outcome"] {
  const baselineScore = replayQualityScore(baseline);
  const candidateScore = replayQualityScore(candidate);
  if (baselineScore === null || candidateScore === null) return "observed";
  if (candidateScore > baselineScore) return "improved";
  if (candidateScore < baselineScore) return "regressed";
  if (deltas.averageLatencyMs < 0) return "improved";
  if (deltas.averageLatencyMs > 0) return "regressed";
  return "unchanged";
}

function replayQualityScore(
  report: KnowledgeRetrievalReplayReport,
): number | null {
  if (report.metrics.averageRecall !== null)
    return report.metrics.averageRecall;
  if (report.metrics.averagePrecision !== null) {
    return report.metrics.averagePrecision;
  }
  return null;
}

function nullableDelta(
  baseline: number | null,
  candidate: number | null,
): number | null {
  return baseline === null || candidate === null ? null : candidate - baseline;
}

function replayAuditMetadata(
  report: KnowledgeRetrievalReplayReport,
): Record<string, unknown> {
  return {
    averageLatencyMs: report.metrics.averageLatencyMs,
    averagePrecision: report.metrics.averagePrecision,
    averageRecall: report.metrics.averageRecall,
    caseCount: report.caseCount,
    expectedChunkCount: report.metrics.expectedChunkCount,
    hitCount: report.metrics.hitCount,
    matchedExpectedChunkCount: report.metrics.matchedExpectedChunkCount,
    status: report.status,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
