import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { RagPolicyChangeRequest, RagPolicyReport } from "./types";
import {
  approveRagPolicyChangeRequestMutationOptions,
  updateRagPolicyMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  approveRagPolicyChangeRequest: vi.fn(),
  createRagPolicyChangeRequest: vi.fn(),
  rejectRagPolicyChangeRequest: vi.fn(),
  updateRagPolicy: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const policy = (source: "default" | "org"): RagPolicyReport => ({
  agentic: { enabled: false, userMode: "optional" },
  allowedEmbeddingProviderModels: [],
  dataResidencyTags: [],
  defaultMaxResultsPerTier: {
    org: 5,
    shared: 5,
    user_private: 5,
    workspace: 5,
  },
  enabledTiers: ["workspace"],
  enforcement: {
    embeddingProviderModelAllowlist: "unrestricted",
    tierBudgets: "enforced",
  },
  externalVectorStore: {
    configured: false,
    drStrategy: "postgres_authoritative_reindex",
    exportPolicy: "metadata_only",
    mode: "disabled",
    namespacePolicy: "none",
    partitioningPolicy: "none",
    restoreValidation: "not_required",
  },
  knowledgeBaseTierAssignments: { org: [], shared: [] },
  maxResultsPerTier: {
    org: 5,
    shared: 5,
    user_private: 5,
    workspace: 5,
  },
  orgId: "org-1",
  physicalVectorIsolation: {
    configured: true,
    enforcement: "required",
    liveEvidenceRequired: false,
    mode: "pgvector_partitioned_by_org",
    postgresAuthoritative: true,
  },
  retention: {
    deleteVectorsOnSourceDelete: true,
    exportIncludesEmbeddingVectors: false,
  },
  retrieval: {
    hybridBm25Weight: 0.5,
    hybridSearch: false,
    similarityThreshold: 0.5,
    topK: 5,
  },
  source,
});

const request = (
  status: RagPolicyChangeRequest["status"],
): RagPolicyChangeRequest => ({
  before: policy("default"),
  changedFields: ["enabledTiers"],
  orgId: "org-1",
  policyPatch: { enabledTiers: ["workspace"] },
  proposed: policy("org"),
  redaction: {
    rawChunkTextReturned: false,
    rawCorpusReturned: false,
    rawQueriesReturned: false,
    rawVectorValuesReturned: false,
    secretRefsReturned: false,
  },
  requestId: "request-1",
  requestedAt: "2026-08-14T00:00:00.000Z",
  requestedBy: "user-1",
  schema: "romeo.rag-policy-change-request.v1",
  status,
});

describe("RAG governance mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles the policy and exactly invalidates its projections", async () => {
    const client = createRomeoQueryClient();
    const keys = [
      appQueryKeys.ragPolicy(),
      appQueryKeys.ragPosture(),
      appQueryKeys.agenticRagSettings(),
    ];
    client.setQueryData(keys[0]!, policy("default"));
    client.setQueryData(keys[1]!, { status: "ready" });
    client.setQueryData(keys[2]!, { enabled: false });
    mutationMocks.updateRagPolicy.mockResolvedValueOnce(policy("org"));
    const observer = new MutationObserver(
      client,
      updateRagPolicyMutationOptions(),
    );

    await observer.mutate({ enabledTiers: ["workspace"] });

    expect(client.getQueryData<RagPolicyReport>(keys[0]!)?.source).toBe("org");
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("keeps the prior policy intact after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.ragPolicy();
    client.setQueryData(key, policy("default"));
    mutationMocks.updateRagPolicy.mockRejectedValueOnce(new Error("conflict"));
    const observer = new MutationObserver(
      client,
      updateRagPolicyMutationOptions(),
    );

    await expect(
      observer.mutate({ enabledTiers: ["workspace"] }),
    ).rejects.toThrow("conflict");
    expect(client.getQueryData(key)).toEqual(policy("default"));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("converges an approved request and every policy projection", async () => {
    const client = createRomeoQueryClient();
    const approved = { ...request("approved"), applied: policy("org") };
    const keys = [
      appQueryKeys.ragPolicyChangeRequest(),
      appQueryKeys.ragPolicy(),
      appQueryKeys.ragPosture(),
      appQueryKeys.agenticRagSettings(),
    ];
    for (const key of keys) client.setQueryData(key, {});
    mutationMocks.approveRagPolicyChangeRequest.mockResolvedValueOnce(approved);
    const observer = new MutationObserver(
      client,
      approveRagPolicyChangeRequestMutationOptions(),
    );

    await observer.mutate("request-1");

    expect(client.getQueryData(keys[0]!)).toEqual(approved);
    expect(client.getQueryData<RagPolicyReport>(keys[1]!)?.source).toBe("org");
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("does not commit an approval that resolves after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveApproval!: (value: RagPolicyChangeRequest) => void;
    mutationMocks.approveRagPolicyChangeRequest.mockReturnValueOnce(
      new Promise<RagPolicyChangeRequest>((resolve) => {
        resolveApproval = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      approveRagPolicyChangeRequestMutationOptions(),
    );
    const pending = observer.mutate("request-1");
    await vi.waitFor(() =>
      expect(mutationMocks.approveRagPolicyChangeRequest).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.ragPolicyChangeRequest();
    client.setQueryData(key, request("pending"));
    resolveApproval(request("approved"));
    await pending;

    expect(client.getQueryData(key)).toEqual(request("pending"));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});
