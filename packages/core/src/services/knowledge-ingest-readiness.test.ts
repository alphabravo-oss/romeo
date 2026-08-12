import { describe, expect, it } from "vitest";

import type { RagPolicyReport } from "../domain/rag-policy";
import {
  assertKnowledgeIngestReady,
  evaluateKnowledgeIngestReadiness,
} from "./knowledge-ingest-readiness";

function policy(
  overrides: Partial<RagPolicyReport> = {},
): RagPolicyReport {
  return {
    orgId: "org_1",
    source: "org",
    enabledTiers: ["workspace"],
    defaultMaxResultsPerTier: { user_private: 4, workspace: 4, org: 4, shared: 4 },
    maxResultsPerTier: { user_private: 8, workspace: 8, org: 8, shared: 8 },
    allowedEmbeddingProviderModels: [
      { providerId: "provider_1", model: "embed-1" },
    ],
    retrieval: {
      topK: 4,
      similarityThreshold: 0.35,
      hybridSearch: true,
      hybridBm25Weight: 0.35,
    },
    agentic: { enabled: false, userMode: "optional" },
    knowledgeBaseTierAssignments: { org: [], shared: [] },
    dataResidencyTags: [],
    externalVectorStore: {
      mode: "disabled",
      namespacePolicy: "none",
      partitioningPolicy: "none",
      configured: false,
      drStrategy: "postgres_authoritative_reindex",
      exportPolicy: "metadata_only",
      restoreValidation: "not_required",
    },
    physicalVectorIsolation: {
      mode: "pgvector_partitioned_by_org",
      enforcement: "required",
      configured: true,
      postgresAuthoritative: true,
      liveEvidenceRequired: false,
    },
    retention: {
      deleteVectorsOnSourceDelete: true,
      exportIncludesEmbeddingVectors: false,
    },
    enforcement: {
      tierBudgets: "enforced",
      embeddingProviderModelAllowlist: "enforced",
    },
    ...overrides,
  };
}

describe("knowledge ingest readiness", () => {
  it("is ready when embedding and a tier are configured", () => {
    expect(evaluateKnowledgeIngestReadiness(policy())).toEqual({ ready: true });
  });

  it("blocks when no embedding model is selected", () => {
    expect(
      evaluateKnowledgeIngestReadiness(
        policy({
          allowedEmbeddingProviderModels: [],
          enforcement: {
            tierBudgets: "enforced",
            embeddingProviderModelAllowlist: "unrestricted",
          },
        }),
      ),
    ).toEqual({ ready: false, reason: "embedding_unset" });
  });

  it("blocks when every RAG tier is off", () => {
    expect(
      evaluateKnowledgeIngestReadiness(policy({ enabledTiers: [] })),
    ).toEqual({ ready: false, reason: "tiers_disabled" });
  });

  it("blocks managed Qdrant when the store is not configured", () => {
    expect(
      evaluateKnowledgeIngestReadiness(
        policy({
          externalVectorStore: {
            mode: "deployment_managed",
            namespacePolicy: "org",
            partitioningPolicy: "org",
            configured: false,
            drStrategy: "postgres_authoritative_reindex",
            exportPolicy: "metadata_only",
            restoreValidation: "required_when_enabled",
          },
        }),
      ),
    ).toEqual({ ready: false, reason: "vector_unconfigured" });
  });

  it("throws a 409 when ingest is not configured", () => {
    expect(() =>
      assertKnowledgeIngestReady(policy({ allowedEmbeddingProviderModels: [] })),
    ).toThrow(/embedding model and RAG policy/);
  });
});
