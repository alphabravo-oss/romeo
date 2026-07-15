import { assertScope, type AuthSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";

import type {
  BackgroundJob,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeSource,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { RagPolicyPhysicalVectorIsolation } from "../domain/rag-policy";
import type {
  ExternalVectorStorePosture,
  VectorStoreDeploymentPosture,
} from "./vector-store-deployment";
import { vectorStoreDeploymentFromEnv } from "./vector-store-deployment";
import { readRagPolicy } from "./rag-policy-service";
import {
  summarizePgvectorPhysicalIsolationEvidence,
  type PgvectorPhysicalIsolationEvidenceSummary,
} from "./pgvector-physical-isolation-evidence";
import {
  summarizeQdrantLiveEvidence,
  type QdrantLiveEvidenceSummary,
} from "./qdrant-live-evidence";

export type RagPostureStatus = "degraded" | "ready";

export interface RagPostureWarning {
  code:
    | "failed_knowledge_jobs"
    | "failed_knowledge_sources"
    | "lexical_fallback_active"
    | "physical_vector_isolation_evidence_pending"
    | "physical_vector_isolation_mismatch"
    | "stale_embedding_records"
    | "stale_source_chunk_counts";
  count: number;
  severity: "info" | "warning";
}

export interface RagPostureReport {
  generatedAt: string;
  orgId: string;
  status: RagPostureStatus;
  vector: {
    driver: VectorStoreDeploymentPosture["activeDriver"];
    authoritativeStore: "postgres";
    isolationMode: VectorStoreDeploymentPosture["isolationMode"];
    pgvectorConfigured: boolean;
    externalVectorStoreConfigured: boolean;
    qdrantConfigured: boolean;
    namespaceConfigured: boolean;
    partitioningConfigured: boolean;
    postureSource: "deployment_default";
    externalStore: ExternalVectorStorePosture & {
      evidence: QdrantLiveEvidenceSummary;
    };
    physicalIsolation: {
      policy: RagPolicyPhysicalVectorIsolation;
      deploymentMode: VectorStoreDeploymentPosture["isolationMode"];
      deploymentMatched: boolean;
      evidence: PgvectorPhysicalIsolationEvidenceSummary;
      externalVectorEvidence: QdrantLiveEvidenceSummary;
      status: "deployment_mismatch" | "evidence_pending" | "satisfied";
    };
  };
  corpus: {
    workspaceCount: number;
    knowledgeBaseCount: number;
    sourceCount: number;
    indexedSourceCount: number;
    pendingSourceCount: number;
    failedSourceCount: number;
    chunkCount: number;
    embeddingCount: number;
    embeddedChunkCount: number;
    chunksMissingProviderEmbeddingCount: number;
    staleEmbeddingRecordCount: number;
    staleSourceCount: number;
    providerModelIndexCount: number;
  };
  jobs: {
    failedEmbeddingIndexJobCount: number;
    failedExtractionJobCount: number;
    failedReindexJobCount: number;
    queuedKnowledgeJobCount: number;
    runningKnowledgeJobCount: number;
  };
  fallback: {
    lexicalFallbackAvailable: boolean;
    degraded: boolean;
    reasonCodes: Array<
      | "no_provider_embeddings"
      | "partial_provider_embedding_coverage"
      | "shared_pgvector_default"
    >;
  };
  readiness: {
    warnings: RagPostureWarning[];
  };
}

export class RagPostureService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly vectorStoreDeployment: VectorStoreDeploymentPosture = vectorStoreDeploymentFromEnv(
      readEnv(),
    ),
    private readonly pgvectorPhysicalIsolationEvidencePath: string = readEnv()
      .PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH,
    private readonly qdrantLiveEvidencePath: string = readEnv()
      .QDRANT_LIVE_EVIDENCE_PATH,
  ) {}

  async report(subject: AuthSubject): Promise<RagPostureReport> {
    assertScope(subject, "admin:read");

    const [
      workspaces,
      jobs,
      ragPolicy,
      pgvectorPhysicalIsolationEvidence,
      qdrantLiveEvidence,
    ] = await Promise.all([
      this.repository.listWorkspaces(subject.orgId),
      this.repository.listBackgroundJobs(subject.orgId),
      readRagPolicy(this.repository, subject.orgId),
      summarizePgvectorPhysicalIsolationEvidence(
        this.pgvectorPhysicalIsolationEvidencePath,
      ),
      summarizeQdrantLiveEvidence(this.qdrantLiveEvidencePath),
    ]);
    const knowledgeBases = (
      await Promise.all(
        workspaces.map((workspace) =>
          this.repository.listKnowledgeBases(workspace.id),
        ),
      )
    ).flat();

    const sourceGroups = await Promise.all(
      knowledgeBases.map((knowledgeBase) =>
        this.repository.listKnowledgeSources(knowledgeBase.id),
      ),
    );
    const chunkGroups = await Promise.all(
      knowledgeBases.map((knowledgeBase) =>
        this.repository.listKnowledgeChunks(knowledgeBase.id),
      ),
    );
    const embeddingGroups = await Promise.all(
      knowledgeBases.map((knowledgeBase) =>
        this.repository.listKnowledgeChunkEmbeddings(knowledgeBase.id),
      ),
    );

    const sources = sourceGroups.flat();
    const chunks = chunkGroups.flat();
    const embeddings = embeddingGroups.flat();
    const corpus = summarizeCorpus({
      chunks,
      embeddings,
      knowledgeBaseCount: knowledgeBases.length,
      sources,
      workspaceCount: workspaces.length,
    });
    const jobPosture = summarizeKnowledgeJobs(jobs);
    const fallback = fallbackPosture(corpus);
    const physicalIsolation = physicalIsolationPosture(
      ragPolicy.physicalVectorIsolation,
      this.vectorStoreDeployment,
      pgvectorPhysicalIsolationEvidence,
      qdrantLiveEvidence,
    );
    const warnings = postureWarnings(
      corpus,
      jobPosture,
      fallback,
      physicalIsolation,
    );
    const externalStore = this.vectorStoreDeployment.externalVectorStore;

    return {
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.some((warning) => warning.severity === "warning")
        ? "degraded"
        : "ready",
      vector: {
        driver: this.vectorStoreDeployment.activeDriver,
        authoritativeStore: "postgres",
        isolationMode: this.vectorStoreDeployment.isolationMode,
        pgvectorConfigured: this.vectorStoreDeployment.pgvectorConfigured,
        externalVectorStoreConfigured: externalStore.configured,
        qdrantConfigured:
          externalStore.driver === "qdrant" && externalStore.configured,
        namespaceConfigured: externalStore.namespacePolicy !== "none",
        partitioningConfigured: externalStore.partitioningPolicy !== "none",
        postureSource: "deployment_default",
        externalStore: {
          ...externalStore,
          evidence: qdrantLiveEvidence,
        },
        physicalIsolation,
      },
      corpus,
      jobs: jobPosture,
      fallback,
      readiness: { warnings },
    };
  }
}

function summarizeCorpus(input: {
  chunks: KnowledgeChunk[];
  embeddings: KnowledgeChunkEmbedding[];
  knowledgeBaseCount: number;
  sources: KnowledgeSource[];
  workspaceCount: number;
}): RagPostureReport["corpus"] {
  const chunkIds = new Set(input.chunks.map((chunk) => chunk.id));
  const embeddedChunkIds = new Set(
    input.embeddings
      .filter((embedding) => chunkIds.has(embedding.chunkId))
      .map((embedding) => embedding.chunkId),
  );
  const chunksBySource = new Map<string, number>();
  for (const chunk of input.chunks) {
    chunksBySource.set(
      chunk.sourceId,
      (chunksBySource.get(chunk.sourceId) ?? 0) + 1,
    );
  }
  const providerModelIndexKeys = new Set(
    input.embeddings.map(
      (embedding) =>
        `${embedding.embeddingProvider}\0${embedding.embeddingModel}\0${embedding.dimensions}`,
    ),
  );

  return {
    workspaceCount: input.workspaceCount,
    knowledgeBaseCount: input.knowledgeBaseCount,
    sourceCount: input.sources.length,
    indexedSourceCount: input.sources.filter(
      (source) => source.status === "indexed",
    ).length,
    pendingSourceCount: input.sources.filter(
      (source) => source.status === "pending",
    ).length,
    failedSourceCount: input.sources.filter(
      (source) => source.status === "failed",
    ).length,
    chunkCount: input.chunks.length,
    embeddingCount: input.embeddings.length,
    embeddedChunkCount: embeddedChunkIds.size,
    chunksMissingProviderEmbeddingCount:
      input.chunks.length - embeddedChunkIds.size,
    staleEmbeddingRecordCount: input.embeddings.filter(
      (embedding) => !chunkIds.has(embedding.chunkId),
    ).length,
    staleSourceCount: input.sources.filter((source) => {
      if (source.status !== "indexed") return false;
      if (source.chunkCount === undefined) return false;
      return source.chunkCount !== (chunksBySource.get(source.id) ?? 0);
    }).length,
    providerModelIndexCount: providerModelIndexKeys.size,
  };
}

function summarizeKnowledgeJobs(
  jobs: BackgroundJob[],
): RagPostureReport["jobs"] {
  const knowledgeJobs = jobs.filter((job) => job.type.startsWith("knowledge."));
  return {
    failedEmbeddingIndexJobCount: knowledgeJobs.filter(
      (job) =>
        job.type === "knowledge.embedding.index" && job.status === "failed",
    ).length,
    failedExtractionJobCount: knowledgeJobs.filter(
      (job) => job.type === "knowledge.extract" && job.status === "failed",
    ).length,
    failedReindexJobCount: knowledgeJobs.filter(
      (job) => job.type === "knowledge.reindex" && job.status === "failed",
    ).length,
    queuedKnowledgeJobCount: knowledgeJobs.filter(
      (job) => job.status === "queued",
    ).length,
    runningKnowledgeJobCount: knowledgeJobs.filter(
      (job) => job.status === "running",
    ).length,
  };
}

function fallbackPosture(
  corpus: RagPostureReport["corpus"],
): RagPostureReport["fallback"] {
  const reasonCodes: RagPostureReport["fallback"]["reasonCodes"] = [
    "shared_pgvector_default",
  ];
  if (corpus.chunkCount > 0 && corpus.embeddedChunkCount === 0) {
    reasonCodes.push("no_provider_embeddings");
  } else if (corpus.chunksMissingProviderEmbeddingCount > 0) {
    reasonCodes.push("partial_provider_embedding_coverage");
  }

  return {
    lexicalFallbackAvailable: true,
    degraded: reasonCodes.some(
      (reason) => reason !== "shared_pgvector_default",
    ),
    reasonCodes,
  };
}

function postureWarnings(
  corpus: RagPostureReport["corpus"],
  jobs: RagPostureReport["jobs"],
  fallback: RagPostureReport["fallback"],
  physicalIsolation: RagPostureReport["vector"]["physicalIsolation"],
): RagPostureWarning[] {
  const warnings: RagPostureWarning[] = [];
  const failedKnowledgeJobs =
    jobs.failedEmbeddingIndexJobCount +
    jobs.failedExtractionJobCount +
    jobs.failedReindexJobCount;
  if (failedKnowledgeJobs > 0) {
    warnings.push({
      code: "failed_knowledge_jobs",
      count: failedKnowledgeJobs,
      severity: "warning",
    });
  }
  if (corpus.failedSourceCount > 0) {
    warnings.push({
      code: "failed_knowledge_sources",
      count: corpus.failedSourceCount,
      severity: "warning",
    });
  }
  if (corpus.staleEmbeddingRecordCount > 0) {
    warnings.push({
      code: "stale_embedding_records",
      count: corpus.staleEmbeddingRecordCount,
      severity: "warning",
    });
  }
  if (corpus.staleSourceCount > 0) {
    warnings.push({
      code: "stale_source_chunk_counts",
      count: corpus.staleSourceCount,
      severity: "warning",
    });
  }
  if (fallback.degraded) {
    warnings.push({
      code: "lexical_fallback_active",
      count: corpus.chunksMissingProviderEmbeddingCount,
      severity: "info",
    });
  }
  if (
    physicalIsolation.policy.enforcement === "required" &&
    physicalIsolation.status === "deployment_mismatch"
  ) {
    warnings.push({
      code: "physical_vector_isolation_mismatch",
      count: 1,
      severity: "warning",
    });
  }
  if (
    physicalIsolation.policy.enforcement === "required" &&
    physicalIsolation.status === "evidence_pending"
  ) {
    warnings.push({
      code: "physical_vector_isolation_evidence_pending",
      count: 1,
      severity: "warning",
    });
  }
  return warnings.sort((left, right) => left.code.localeCompare(right.code));
}

function physicalIsolationPosture(
  policy: RagPolicyPhysicalVectorIsolation,
  deployment: VectorStoreDeploymentPosture,
  pgvectorPhysicalIsolationEvidence: PgvectorPhysicalIsolationEvidenceSummary,
  qdrantLiveEvidence: QdrantLiveEvidenceSummary,
): RagPostureReport["vector"]["physicalIsolation"] {
  const deploymentMatched = physicalIsolationDeploymentMatched(
    policy.mode,
    deployment,
  );
  const evidenceSatisfied =
    policy.mode === "pgvector_partitioned_by_org" &&
    deploymentMatched &&
    pgvectorPhysicalIsolationEvidence.status === "satisfied";
  const qdrantEvidenceSatisfied =
    (policy.mode === "external_namespace_per_org" ||
      policy.mode === "external_collection_per_org" ||
      policy.mode === "dedicated_vector_store_per_org") &&
    deploymentMatched &&
    qdrantLiveEvidence.status === "satisfied" &&
    qdrantLiveEvidence.namespacePolicy ===
      deployment.externalVectorStore.namespacePolicy &&
    qdrantLiveEvidence.partitioningPolicy ===
      deployment.externalVectorStore.partitioningPolicy;
  const status =
    (policy.mode === "shared_row_scope" && deploymentMatched) ||
    evidenceSatisfied ||
    qdrantEvidenceSatisfied
      ? "satisfied"
      : deploymentMatched
        ? "evidence_pending"
        : "deployment_mismatch";
  return {
    policy,
    deploymentMode: deployment.isolationMode,
    deploymentMatched,
    evidence: pgvectorPhysicalIsolationEvidence,
    externalVectorEvidence: qdrantLiveEvidence,
    status,
  };
}

function physicalIsolationDeploymentMatched(
  mode: RagPolicyPhysicalVectorIsolation["mode"],
  deployment: VectorStoreDeploymentPosture,
): boolean {
  if (mode === "shared_row_scope") {
    return deployment.isolationMode === "shared_row_scope";
  }
  if (mode === "pgvector_partitioned_by_org") {
    return deployment.isolationMode === "pgvector_partitioned_by_org";
  }
  if (mode === "external_namespace_per_org") {
    return (
      deployment.isolationMode === "external_namespace_per_org" &&
      deployment.externalVectorStore.driver === "qdrant" &&
      deployment.externalVectorStore.configured &&
      deployment.externalVectorStore.namespacePolicy === "org"
    );
  }
  if (mode === "external_collection_per_org") {
    return (
      deployment.isolationMode === "external_collection_per_org" &&
      deployment.externalVectorStore.driver === "qdrant" &&
      deployment.externalVectorStore.configured
    );
  }
  return deployment.isolationMode === "dedicated_vector_store_per_org";
}
