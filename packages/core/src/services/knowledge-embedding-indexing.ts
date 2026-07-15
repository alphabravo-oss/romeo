import {
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import {
  getEmbeddingAdapter,
  type EmbeddingProviderAdapter,
} from "@romeo/providers";

import type {
  BackgroundJob,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  ProviderInstance,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { recordSubjectUsage } from "./record-usage";
import { writeAuditLog } from "./audit-log";
import {
  assertEmbeddingProviderModelAllowed,
  readRagPolicy,
} from "./rag-policy-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";

export interface KnowledgeEmbeddingIndexResult {
  job: BackgroundJob;
  embeddingCount: number;
  dimensions: number | null;
  providerId: string;
  model: string;
}

export interface IndexKnowledgeEmbeddingsInput {
  adapter?: EmbeddingProviderAdapter;
  batchSize?: number;
  fetchImpl?: typeof fetch;
  knowledgeBaseId: string;
  model: string;
  providerId: string;
  repository: RomeoRepository;
  subject: AuthSubject;
  vectorStore?: KnowledgeVectorStore;
}

const defaultBatchSize = 16;
const maxBatchSize = 64;
const expectedDimensions = 1536;

export async function indexKnowledgeEmbeddings(
  input: IndexKnowledgeEmbeddingsInput,
): Promise<KnowledgeEmbeddingIndexResult> {
  const knowledgeBase = await getAuthorizedKnowledgeBase(input.repository, {
    knowledgeBaseId: input.knowledgeBaseId,
    subject: input.subject,
    scope: "knowledge:write",
    permission: "write",
  });
  assertScope(input.subject, "models:use");
  const provider = await getAuthorizedEmbeddingProvider(
    input.repository,
    input.subject,
    input.providerId,
  );
  const ragPolicy = await readRagPolicy(input.repository, knowledgeBase.orgId);
  assertEmbeddingProviderModelAllowed(ragPolicy, provider.id, input.model);
  const chunks = await input.repository.listKnowledgeChunks(knowledgeBase.id);
  const batchSize = boundedBatchSize(input.batchSize);
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "worker.enqueue",
    providerId: provider.id,
    workspaceId: knowledgeBase.workspaceId,
    workerClass: "knowledge.embedding.index",
  });
  const job = await startBackgroundJob(input.repository, {
    orgId: knowledgeBase.orgId,
    workspaceId: knowledgeBase.workspaceId,
    type: "knowledge.embedding.index",
    payload: {
      knowledgeBaseId: knowledgeBase.id,
      providerId: provider.id,
      model: input.model,
      chunkCount: chunks.length,
      batchSize,
    },
  });

  try {
    const batchInput = {
      adapter: input.adapter ?? getEmbeddingAdapter(provider.type),
      batchSize,
      chunks,
      knowledgeBase,
      model: input.model,
      ragPolicy,
      provider,
      ...(input.vectorStore === undefined
        ? {}
        : { vectorStore: input.vectorStore }),
    };
    const result = await indexChunkBatches(
      input.repository,
      input.fetchImpl === undefined
        ? batchInput
        : { ...batchInput, fetchImpl: input.fetchImpl },
    );
    await recordSubjectUsage(input.repository, input.subject, {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
      sourceType: "storage",
      sourceId: knowledgeBase.id,
      metric: "storage.embedding_indexed",
      quantity: result.embeddingCount,
      unit: "embedding",
      metadata: {
        jobId: job.id,
        knowledgeBaseId: knowledgeBase.id,
        providerId: provider.id,
        model: input.model,
        dimensions: result.dimensions,
      },
    });
    await writeAuditLog(input.repository, {
      subject: input.subject,
      action: "knowledge.embedding.index",
      resourceType: "knowledge_base",
      resourceId: knowledgeBase.id,
      metadata: {
        jobId: job.id,
        providerId: provider.id,
        model: input.model,
        embeddingCount: result.embeddingCount,
        dimensions: result.dimensions,
      },
    });
    return {
      ...result,
      job: await completeBackgroundJob(input.repository, job),
      providerId: provider.id,
      model: input.model,
    };
  } catch (error) {
    await failBackgroundJob(input.repository, job, errorCode(error));
    throw error;
  }
}

async function getAuthorizedEmbeddingProvider(
  repository: RomeoRepository,
  subject: AuthSubject,
  providerId: string,
): Promise<ProviderInstance> {
  const provider = await repository.getProvider(providerId);
  if (!provider || !canAccessOrg(subject, provider.orgId))
    throw notFound("Provider");
  const grants = await repository.listResourceGrants(subject.orgId);
  if (!hasGrant(subject, grants, "provider", provider.id, "use")) {
    throw new ApiError(
      "provider_use_forbidden",
      "Missing use permission for the embedding provider.",
      403,
      { providerId: provider.id },
    );
  }
  return provider;
}

async function indexChunkBatches(
  repository: RomeoRepository,
  input: {
    adapter: EmbeddingProviderAdapter;
    batchSize: number;
    chunks: KnowledgeChunk[];
    fetchImpl?: typeof fetch;
    knowledgeBase: KnowledgeBase;
    model: string;
    provider: ProviderInstance;
    ragPolicy: Awaited<ReturnType<typeof readRagPolicy>>;
    vectorStore?: KnowledgeVectorStore;
  },
): Promise<{ embeddingCount: number; dimensions: number | null }> {
  let embeddingCount = 0;
  let dimensions: number | null = null;
  for (let start = 0; start < input.chunks.length; start += input.batchSize) {
    const chunks = input.chunks.slice(start, start + input.batchSize);
    const request = {
      provider: input.provider,
      model: input.model,
      texts: chunks.map((chunk) => chunk.content),
    };
    const result = await input.adapter.embedTexts(
      input.fetchImpl === undefined
        ? request
        : { ...request, fetchImpl: input.fetchImpl },
    );
    assertEmbeddingProviderModelAllowed(
      input.ragPolicy,
      input.provider.id,
      result.model,
    );
    if (result.dimensions !== expectedDimensions) {
      throw new ApiError(
        "embedding_dimensions_unsupported",
        "Embedding dimensions do not match the configured pgvector baseline.",
        422,
        {
          dimensions: result.dimensions,
          expectedDimensions,
        },
      );
    }
    dimensions = result.dimensions;
    const now = new Date().toISOString();
    const embeddings = chunks.map(
      (chunk, index): KnowledgeChunkEmbedding => ({
        id: createId("kb_embedding"),
        knowledgeBaseId: input.knowledgeBase.id,
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        orgId: input.knowledgeBase.orgId,
        workspaceId: input.knowledgeBase.workspaceId,
        embeddingProvider: input.provider.id,
        embeddingModel: result.model,
        dimensions: result.dimensions,
        embedding: result.embeddings[index] ?? [],
        metadata: { providerType: input.provider.type },
        createdAt: now,
        updatedAt: now,
      }),
    );
    await repository.upsertKnowledgeChunkEmbeddings(embeddings);
    await input.vectorStore?.upsertEmbeddings(embeddings);
    embeddingCount += result.embeddings.length;
  }
  return { embeddingCount, dimensions };
}

function boundedBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) return defaultBatchSize;
  return Math.min(Math.max(batchSize, 1), maxBatchSize);
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return error instanceof Error ? error.constructor.name : "unknown_error";
}
