import { describe, expect, it } from "vitest";

import {
  buildBudgetPatch,
  buildRagValidateChecklist,
  formatEmbeddingAllowlist,
  parseEmbeddingAllowlist,
  policyFieldsForVectorBackend,
  vectorBackendPresetFromPolicy,
} from "./rag-setup";

describe("vector backend preset", () => {
  it("maps deployment_managed external store to qdrant", () => {
    expect(
      vectorBackendPresetFromPolicy({
        externalVectorStore: {
          mode: "deployment_managed",
          namespacePolicy: "org",
          partitioningPolicy: "org",
          configured: true,
          drStrategy: "postgres_authoritative_reindex",
          exportPolicy: "metadata_only",
          restoreValidation: "required_when_enabled",
        },
      }),
    ).toBe("qdrant");
  });

  it("defaults disabled external store to pgvector", () => {
    expect(
      vectorBackendPresetFromPolicy({
        externalVectorStore: {
          mode: "disabled",
          namespacePolicy: "none",
          partitioningPolicy: "none",
          configured: false,
          drStrategy: "postgres_authoritative_reindex",
          exportPolicy: "metadata_only",
          restoreValidation: "not_required",
        },
      }),
    ).toBe("pgvector");
  });

  it("builds policy fields for each preset", () => {
    expect(policyFieldsForVectorBackend("pgvector").externalVectorStore).toEqual(
      expect.objectContaining({ mode: "disabled" }),
    );
    expect(policyFieldsForVectorBackend("qdrant").externalVectorStore).toEqual(
      expect.objectContaining({ mode: "deployment_managed" }),
    );
  });
});

describe("embedding allowlist parse/format", () => {
  it("parses providerId model and providerId:model lines", () => {
    expect(
      parseEmbeddingAllowlist(
        "provider_openai text-embedding-3-small\n# comment\nprovider_ollama:nomic-embed-text\n",
      ),
    ).toEqual([
      { providerId: "provider_openai", model: "text-embedding-3-small" },
      { providerId: "provider_ollama", model: "nomic-embed-text" },
    ]);
  });

  it("round-trips through format", () => {
    const models = [
      { providerId: "p1", model: "m1" },
      { providerId: "p2", model: "m2" },
    ];
    expect(parseEmbeddingAllowlist(formatEmbeddingAllowlist(models))).toEqual(
      models,
    );
  });
});

describe("budgets", () => {
  it("parses valid budget fields", () => {
    expect(
      buildBudgetPatch({
        user_private: "3",
        workspace: "5",
        org: "2",
        shared: "1",
      }),
    ).toEqual({
      user_private: 3,
      workspace: 5,
      org: 2,
      shared: 1,
    });
  });

  it("rejects out-of-range budgets", () => {
    expect(
      buildBudgetPatch({
        user_private: "0",
        workspace: "21",
        org: "x",
        shared: "",
      }),
    ).toBeUndefined();
  });
});

describe("buildRagValidateChecklist", () => {
  it("flags missing qdrant when expected", () => {
    const checks = buildRagValidateChecklist(
      {
        status: "degraded",
        vector: {
          driver: "pgvector",
          pgvectorConfigured: true,
          qdrantConfigured: false,
          authoritativeStore: "postgres",
          physicalIsolation: {
            status: "satisfied",
            deploymentMatched: true,
          },
          externalStore: {
            driver: "disabled",
            configured: false,
            routingActive: false,
            endpointConfigured: false,
          },
        },
        corpus: {
          knowledgeBaseCount: 0,
          embeddingCount: 0,
          chunksMissingProviderEmbeddingCount: 0,
        },
        fallback: { degraded: false },
        readiness: { warnings: [] },
      },
      "qdrant",
    );
    expect(checks.find((c) => c.id === "qdrant")?.ok).toBe(false);
    expect(checks.find((c) => c.id === "pgvector")?.ok).toBe(true);
  });
});
