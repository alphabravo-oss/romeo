import type { RagPolicyReport } from "../domain/rag-policy";
import { ApiError } from "../errors";

export type KnowledgeIngestBlockReason =
  | "embedding_unset"
  | "tiers_disabled"
  | "vector_unconfigured";

export interface KnowledgeIngestReadiness {
  ready: boolean;
  reason?: KnowledgeIngestBlockReason;
}

/** Uploads need a chosen embedding model and at least one live RAG tier. */
export function evaluateKnowledgeIngestReadiness(
  policy: RagPolicyReport,
): KnowledgeIngestReadiness {
  if (policy.enabledTiers.length === 0) {
    return { ready: false, reason: "tiers_disabled" };
  }
  if (policy.allowedEmbeddingProviderModels.length === 0) {
    return { ready: false, reason: "embedding_unset" };
  }
  if (
    policy.externalVectorStore.mode === "deployment_managed" &&
    !policy.externalVectorStore.configured
  ) {
    return { ready: false, reason: "vector_unconfigured" };
  }
  return { ready: true };
}

export function assertKnowledgeIngestReady(policy: RagPolicyReport): void {
  const readiness = evaluateKnowledgeIngestReadiness(policy);
  if (readiness.ready) return;
  throw new ApiError(
    "knowledge_ingest_not_configured",
    "Knowledge upload requires a configured embedding model and RAG policy.",
    409,
    readiness.reason === undefined ? {} : { reason: readiness.reason },
  );
}
