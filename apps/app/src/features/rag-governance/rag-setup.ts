import type {
  RagPolicyReport,
  UpdateRagPolicyRequest,
} from "@romeo/api-client/generated/sdk";

import type {
  RagPolicyExternalVectorMode,
  RagPolicyPhysicalVectorIsolationMode,
  RagPolicyTier,
} from "./types";

/** Product-facing vector backend choice (Postgres always authoritative). */
export type RagVectorBackendPreset = "pgvector" | "qdrant";

export interface EmbeddingProviderModelRef {
  providerId: string;
  model: string;
}

export function vectorBackendPresetFromPolicy(
  policy: Pick<RagPolicyReport, "externalVectorStore">,
): RagVectorBackendPreset {
  return policy.externalVectorStore.mode === "deployment_managed"
    ? "qdrant"
    : "pgvector";
}

export function policyFieldsForVectorBackend(
  preset: RagVectorBackendPreset,
): Pick<
  UpdateRagPolicyRequest,
  "externalVectorStore" | "physicalVectorIsolation"
> {
  if (preset === "qdrant") {
    return {
      externalVectorStore: {
        mode: "deployment_managed" satisfies RagPolicyExternalVectorMode,
        namespacePolicy: "org",
        partitioningPolicy: "org",
      },
      physicalVectorIsolation: {
        mode: "external_namespace_per_org" satisfies RagPolicyPhysicalVectorIsolationMode,
        enforcement: "advisory",
      },
    };
  }
  return {
    externalVectorStore: {
      mode: "disabled" satisfies RagPolicyExternalVectorMode,
      namespacePolicy: "none",
      partitioningPolicy: "none",
    },
    physicalVectorIsolation: {
      mode: "pgvector_partitioned_by_org" satisfies RagPolicyPhysicalVectorIsolationMode,
      enforcement: "required",
    },
  };
}

/** Parse allowlist lines: `providerId model` or `providerId:model`. */
export function parseEmbeddingAllowlist(
  text: string,
): EmbeddingProviderModelRef[] {
  const seen = new Set<string>();
  const out: EmbeddingProviderModelRef[] = [];
  for (const raw of text.split(/\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^([^\s:]+)[\s:]+(.+)$/u.exec(line);
    if (match === null) continue;
    const providerId = match[1]!.trim();
    const model = match[2]!.trim();
    if (providerId.length === 0 || model.length === 0) continue;
    const key = `${providerId}\0${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ providerId, model });
  }
  return out;
}

export function formatEmbeddingAllowlist(
  models: readonly EmbeddingProviderModelRef[],
): string {
  return models.map((entry) => `${entry.providerId} ${entry.model}`).join("\n");
}

export function budgetsToFormValues(
  budget: RagPolicyReport["defaultMaxResultsPerTier"],
): Record<RagPolicyTier, string> {
  return {
    user_private: String(budget.user_private),
    workspace: String(budget.workspace),
    org: String(budget.org),
    shared: String(budget.shared),
  };
}

export function parseBudgetField(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (n < 1 || n > 20) return undefined;
  return n;
}

export function buildBudgetPatch(
  values: Record<RagPolicyTier, string>,
): Partial<Record<RagPolicyTier, number>> | undefined {
  const patch: Partial<Record<RagPolicyTier, number>> = {};
  for (const tier of [
    "user_private",
    "workspace",
    "org",
    "shared",
  ] as const satisfies readonly RagPolicyTier[]) {
    const parsed = parseBudgetField(values[tier]);
    if (parsed !== undefined) patch[tier] = parsed;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export interface RagValidateCheck {
  id: string;
  ok: boolean;
  detail: string;
}

/** Pure posture → checklist for Validate UI (no I/O). */
export function buildRagValidateChecklist(
  posture: {
    status: string;
    vector: {
      driver: string;
      pgvectorConfigured: boolean;
      qdrantConfigured: boolean;
      authoritativeStore: string;
      physicalIsolation: { status: string; deploymentMatched: boolean };
      externalStore: {
        driver: string;
        configured: boolean;
        routingActive: boolean;
        endpointConfigured: boolean;
      };
    };
    corpus: {
      knowledgeBaseCount: number;
      embeddingCount: number;
      chunksMissingProviderEmbeddingCount: number;
    };
    fallback: { degraded: boolean };
    readiness: { warnings: readonly { code: string; count?: number }[] };
  },
  expectedBackend: RagVectorBackendPreset,
): RagValidateCheck[] {
  const checks: RagValidateCheck[] = [];
  checks.push({
    id: "authoritative_postgres",
    ok: posture.vector.authoritativeStore === "postgres",
    detail: `Authoritative store: ${posture.vector.authoritativeStore}`,
  });
  checks.push({
    id: "pgvector",
    ok: posture.vector.pgvectorConfigured,
    detail: posture.vector.pgvectorConfigured
      ? "pgvector is configured (default index)"
      : "pgvector is not configured",
  });
  if (expectedBackend === "qdrant") {
    const qOk =
      posture.vector.qdrantConfigured &&
      posture.vector.externalStore.driver === "qdrant" &&
      posture.vector.externalStore.endpointConfigured;
    checks.push({
      id: "qdrant",
      ok: qOk,
      detail: qOk
        ? "Qdrant external store is configured"
        : "Qdrant expected but not fully configured (set QDRANT_URL / collection in deployment)",
    });
  } else {
    checks.push({
      id: "qdrant_optional",
      ok: true,
      detail: posture.vector.qdrantConfigured
        ? "Qdrant is available but policy can stay pgvector-only"
        : "pgvector-only mode (Qdrant not required)",
    });
  }
  checks.push({
    id: "isolation",
    ok:
      posture.vector.physicalIsolation.status === "satisfied" ||
      posture.vector.physicalIsolation.status === "evidence_pending",
    detail: `Physical isolation: ${posture.vector.physicalIsolation.status}`,
  });
  checks.push({
    id: "embeddings_corpus",
    ok:
      posture.corpus.embeddingCount > 0 ||
      posture.corpus.knowledgeBaseCount === 0,
    detail:
      posture.corpus.knowledgeBaseCount === 0
        ? "No knowledge bases yet — create one and index embeddings"
        : `${posture.corpus.embeddingCount} embeddings; ${posture.corpus.chunksMissingProviderEmbeddingCount} chunks missing provider embeddings`,
  });
  checks.push({
    id: "overall",
    ok: posture.status === "ready" && !posture.fallback.degraded,
    detail:
      posture.status === "ready" && !posture.fallback.degraded
        ? "Posture ready"
        : `Posture ${posture.status}${posture.fallback.degraded ? " (degraded fallback)" : ""}${posture.readiness.warnings.length > 0 ? `; ${posture.readiness.warnings.length} warning(s)` : ""}`,
  });
  return checks;
}
