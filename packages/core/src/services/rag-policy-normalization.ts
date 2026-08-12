import {
  ragPolicyExternalVectorDrStrategies,
  ragPolicyExternalVectorExportPolicies,
  ragPolicyExternalVectorModes,
  ragPolicyPhysicalVectorIsolationEnforcements,
  ragPolicyPhysicalVectorIsolationModes,
  ragPolicyAgenticUserModes,
  ragPolicyTiers,
  ragVectorIsolationPolicies,
  type RagPolicyBudgetMap,
  type RagPolicyKnowledgeBaseTierAssignments,
  type RagPolicyProviderModel,
  type RagPolicyTier,
  type UpdateRagPolicyRequest,
} from "../domain/rag-policy";
import { ApiError } from "../errors";
import {
  defaultAgenticSettings,
  defaultBudget,
  defaultMaxBudget,
  defaultRetrievalSettings,
  type StoredExternalVectorStorePolicy,
  type StoredPhysicalVectorIsolationPolicy,
  type StoredRagPolicy,
} from "./rag-policy-types";
import type {
  RagPolicyAgenticSettings,
  RagPolicyRetrievalSettings,
} from "../domain/rag-policy";

export function parseStoredPolicy(
  value: Record<string, unknown>,
  orgId: string,
): StoredRagPolicy {
  if (value.version !== 1 || value.orgId !== orgId) {
    return defaultStoredPolicy(orgId);
  }
  return {
    version: 1,
    orgId,
    enabledTiers: normalizeTiers(value.enabledTiers, defaultTiers()),
    defaultMaxResultsPerTier: normalizeBudgetMap(
      value.defaultMaxResultsPerTier,
      defaultBudget,
    ),
    maxResultsPerTier: normalizeBudgetMap(
      value.maxResultsPerTier,
      defaultMaxBudget,
    ),
    allowedEmbeddingProviderModels: normalizeProviderModels(
      value.allowedEmbeddingProviderModels,
    ),
    retrieval: normalizeRetrievalSettings(value.retrieval),
    agentic: normalizeAgenticSettings(value.agentic),
    knowledgeBaseTierAssignments: normalizeTierAssignments(
      value.knowledgeBaseTierAssignments,
    ),
    dataResidencyTags: normalizeTags(value.dataResidencyTags),
    externalVectorStore: normalizeExternalVectorStore(
      value.externalVectorStore,
      defaultExternalVectorStorePolicy(),
    ),
    physicalVectorIsolation: normalizePhysicalVectorIsolation(
      value.physicalVectorIsolation,
      defaultPhysicalVectorIsolationPolicy(),
    ),
    ...(typeof value.updatedAt === "string"
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(typeof value.updatedBy === "string"
      ? { updatedBy: value.updatedBy }
      : {}),
  };
}

export function defaultStoredPolicy(orgId: string): StoredRagPolicy {
  return {
    version: 1,
    orgId,
    enabledTiers: defaultTiers(),
    defaultMaxResultsPerTier: { ...defaultBudget },
    maxResultsPerTier: { ...defaultMaxBudget },
    allowedEmbeddingProviderModels: [],
    retrieval: { ...defaultRetrievalSettings },
    agentic: { ...defaultAgenticSettings },
    knowledgeBaseTierAssignments: emptyTierAssignments(),
    dataResidencyTags: [],
    externalVectorStore: defaultExternalVectorStorePolicy(),
    physicalVectorIsolation: defaultPhysicalVectorIsolationPolicy(),
  };
}

export function defaultTiers(): RagPolicyTier[] {
  return [...ragPolicyTiers];
}

export function applyPolicyPatch(
  existing: StoredRagPolicy,
  patch: UpdateRagPolicyRequest,
  updatedAt: string,
  updatedBy: string,
): StoredRagPolicy {
  const next: StoredRagPolicy = {
    ...existing,
    enabledTiers:
      patch.enabledTiers === undefined
        ? existing.enabledTiers
        : normalizeTiers(patch.enabledTiers, []),
    defaultMaxResultsPerTier:
      patch.defaultMaxResultsPerTier === undefined
        ? { ...existing.defaultMaxResultsPerTier }
        : {
            ...existing.defaultMaxResultsPerTier,
            ...patch.defaultMaxResultsPerTier,
          },
    maxResultsPerTier:
      patch.maxResultsPerTier === undefined
        ? { ...existing.maxResultsPerTier }
        : { ...existing.maxResultsPerTier, ...patch.maxResultsPerTier },
    allowedEmbeddingProviderModels:
      patch.allowedEmbeddingProviderModels === undefined
        ? existing.allowedEmbeddingProviderModels
        : normalizeProviderModels(patch.allowedEmbeddingProviderModels),
    retrieval: normalizeRetrievalSettings({
      ...defaultRetrievalSettings,
      ...existing.retrieval,
      ...(patch.retrieval ?? {}),
    }),
    agentic: normalizeAgenticSettings({
      ...defaultAgenticSettings,
      ...existing.agentic,
      ...(patch.agentic ?? {}),
    }),
    knowledgeBaseTierAssignments:
      patch.knowledgeBaseTierAssignments === undefined
        ? cloneTierAssignments(existing.knowledgeBaseTierAssignments)
        : mergeTierAssignments(
            existing.knowledgeBaseTierAssignments,
            patch.knowledgeBaseTierAssignments,
          ),
    dataResidencyTags:
      patch.dataResidencyTags === undefined
        ? existing.dataResidencyTags
        : normalizeTags(patch.dataResidencyTags),
    externalVectorStore:
      patch.externalVectorStore === undefined
        ? { ...existing.externalVectorStore }
        : normalizeExternalVectorStore(
            { ...existing.externalVectorStore, ...patch.externalVectorStore },
            existing.externalVectorStore,
          ),
    physicalVectorIsolation:
      patch.physicalVectorIsolation === undefined
        ? { ...existing.physicalVectorIsolation }
        : normalizePhysicalVectorIsolation(
            {
              ...existing.physicalVectorIsolation,
              ...patch.physicalVectorIsolation,
            },
            existing.physicalVectorIsolation,
          ),
    updatedAt,
    updatedBy,
  };
  assertBudgetPolicy(next);
  assertTierAssignmentPolicy(next);
  assertExternalVectorPolicy(next);
  assertPhysicalVectorIsolationPolicy(next);
  return next;
}

function assertBudgetPolicy(policy: StoredRagPolicy): void {
  for (const tier of ragPolicyTiers) {
    if (
      policy.defaultMaxResultsPerTier[tier] > policy.maxResultsPerTier[tier]
    ) {
      throw new ApiError(
        "invalid_rag_policy_budget",
        "Default tier result budget cannot exceed the maximum tier result budget.",
        400,
        { tier },
      );
    }
  }
}

export function normalizeTiers(
  value: unknown,
  fallback: RagPolicyTier[],
): RagPolicyTier[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<RagPolicyTier>();
  for (const item of value) {
    if (isRagPolicyTier(item)) seen.add(item);
  }
  return ragPolicyTiers.filter((tier) => seen.has(tier));
}

export function normalizeBudgetMap(
  value: unknown,
  fallback: RagPolicyBudgetMap,
): RagPolicyBudgetMap {
  const map: RagPolicyBudgetMap = { ...fallback };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }
  for (const tier of ragPolicyTiers) {
    const budget = (value as Record<string, unknown>)[tier];
    if (typeof budget === "number" && Number.isInteger(budget)) {
      map[tier] = Math.min(20, Math.max(1, budget));
    }
  }
  return map;
}

export function normalizeProviderModels(
  value: unknown,
): RagPolicyProviderModel[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, RagPolicyProviderModel>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const providerId = (item as { providerId?: unknown }).providerId;
    const model = (item as { model?: unknown }).model;
    if (typeof providerId !== "string" || typeof model !== "string") continue;
    const normalized = {
      providerId: providerId.trim(),
      model: model.trim(),
    };
    if (normalized.providerId.length === 0 || normalized.model.length === 0) {
      continue;
    }
    unique.set(`${normalized.providerId}\0${normalized.model}`, normalized);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.model.localeCompare(right.model),
  );
}

export function normalizeRetrievalSettings(
  value: unknown,
): RagPolicyRetrievalSettings {
  const settings: RagPolicyRetrievalSettings = { ...defaultRetrievalSettings };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return settings;
  }
  const input = value as Record<string, unknown>;
  if (typeof input.topK === "number" && Number.isInteger(input.topK)) {
    settings.topK = Math.min(20, Math.max(1, input.topK));
  }
  if (
    typeof input.similarityThreshold === "number" &&
    Number.isFinite(input.similarityThreshold)
  ) {
    settings.similarityThreshold = Math.min(
      1,
      Math.max(0, input.similarityThreshold),
    );
  }
  if (typeof input.hybridSearch === "boolean") {
    settings.hybridSearch = input.hybridSearch;
  }
  if (
    typeof input.hybridBm25Weight === "number" &&
    Number.isFinite(input.hybridBm25Weight)
  ) {
    settings.hybridBm25Weight = Math.min(1, Math.max(0, input.hybridBm25Weight));
  }
  return settings;
}

export function normalizeAgenticSettings(
  value: unknown,
): RagPolicyAgenticSettings {
  const settings: RagPolicyAgenticSettings = { ...defaultAgenticSettings };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return settings;
  }
  const input = value as Record<string, unknown>;
  if (typeof input.enabled === "boolean") settings.enabled = input.enabled;
  settings.userMode = normalizeEnum(
    input.userMode,
    ragPolicyAgenticUserModes,
    settings.userMode,
  );
  return settings;
}

function emptyTierAssignments(): RagPolicyKnowledgeBaseTierAssignments {
  return { org: [], shared: [] };
}

export function cloneTierAssignments(
  assignments: RagPolicyKnowledgeBaseTierAssignments,
): RagPolicyKnowledgeBaseTierAssignments {
  return {
    org: [...assignments.org],
    shared: [...assignments.shared],
  };
}

function mergeTierAssignments(
  existing: RagPolicyKnowledgeBaseTierAssignments,
  patch: Partial<RagPolicyKnowledgeBaseTierAssignments>,
): RagPolicyKnowledgeBaseTierAssignments {
  return {
    org:
      patch.org === undefined
        ? [...existing.org]
        : normalizeKnowledgeBaseIds(patch.org),
    shared:
      patch.shared === undefined
        ? [...existing.shared]
        : normalizeKnowledgeBaseIds(patch.shared),
  };
}

export function normalizeTierAssignments(
  value: unknown,
): RagPolicyKnowledgeBaseTierAssignments {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return emptyTierAssignments();
  }
  const assignments = value as Record<string, unknown>;
  const shared = normalizeKnowledgeBaseIds(assignments.shared);
  const sharedIds = new Set(shared);
  return {
    org: normalizeKnowledgeBaseIds(assignments.org).filter(
      (knowledgeBaseId) => !sharedIds.has(knowledgeBaseId),
    ),
    shared,
  };
}

function normalizeKnowledgeBaseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function assertTierAssignmentPolicy(policy: StoredRagPolicy): void {
  const sharedIds = new Set(policy.knowledgeBaseTierAssignments.shared);
  const overlap = policy.knowledgeBaseTierAssignments.org.find(
    (knowledgeBaseId) => sharedIds.has(knowledgeBaseId),
  );
  if (overlap === undefined) return;
  throw new ApiError(
    "invalid_rag_policy_tier_assignment",
    "A knowledge base cannot be assigned to multiple RAG tiers.",
    400,
  );
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function defaultExternalVectorStorePolicy(): StoredExternalVectorStorePolicy {
  return {
    mode: "disabled",
    namespacePolicy: "none",
    partitioningPolicy: "none",
    drStrategy: "postgres_authoritative_reindex",
    exportPolicy: "metadata_only",
  };
}

export function defaultPhysicalVectorIsolationPolicy(): StoredPhysicalVectorIsolationPolicy {
  return {
    mode: "shared_row_scope",
    enforcement: "advisory",
  };
}

export function normalizeExternalVectorStore(
  value: unknown,
  fallback: StoredExternalVectorStorePolicy,
): StoredExternalVectorStorePolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const input = value as Record<string, unknown>;
  const mode = normalizeEnum(
    input.mode,
    ragPolicyExternalVectorModes,
    fallback.mode,
  );
  const disabled = mode === "disabled";
  return {
    mode,
    namespacePolicy: disabled
      ? "none"
      : normalizeEnum(
          input.namespacePolicy,
          ragVectorIsolationPolicies,
          fallback.namespacePolicy,
        ),
    partitioningPolicy: disabled
      ? "none"
      : normalizeEnum(
          input.partitioningPolicy,
          ragVectorIsolationPolicies,
          fallback.partitioningPolicy,
        ),
    drStrategy: normalizeEnum(
      input.drStrategy,
      ragPolicyExternalVectorDrStrategies,
      fallback.drStrategy,
    ),
    exportPolicy: normalizeEnum(
      input.exportPolicy,
      ragPolicyExternalVectorExportPolicies,
      fallback.exportPolicy,
    ),
  };
}

function assertExternalVectorPolicy(policy: StoredRagPolicy): void {
  if (
    policy.externalVectorStore.mode === "deployment_managed" &&
    policy.externalVectorStore.namespacePolicy === "none"
  ) {
    throw new ApiError(
      "invalid_rag_external_vector_policy",
      "Deployment-managed external vector policy requires a namespace policy.",
      400,
    );
  }
}

export function normalizePhysicalVectorIsolation(
  value: unknown,
  fallback: StoredPhysicalVectorIsolationPolicy,
): StoredPhysicalVectorIsolationPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const input = value as Record<string, unknown>;
  return {
    mode: normalizeEnum(
      input.mode,
      ragPolicyPhysicalVectorIsolationModes,
      fallback.mode,
    ),
    enforcement: normalizeEnum(
      input.enforcement,
      ragPolicyPhysicalVectorIsolationEnforcements,
      fallback.enforcement,
    ),
  };
}

function assertPhysicalVectorIsolationPolicy(policy: StoredRagPolicy): void {
  if (
    policy.physicalVectorIsolation.enforcement === "required" &&
    policy.physicalVectorIsolation.mode === "shared_row_scope" &&
    policy.externalVectorStore.mode === "deployment_managed"
  ) {
    throw new ApiError(
      "invalid_rag_physical_vector_isolation_policy",
      "Required shared-row vector isolation cannot be combined with deployment-managed external vector routing.",
      400,
    );
  }
}

export function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function isRagPolicyTier(value: unknown): value is RagPolicyTier {
  return (
    typeof value === "string" &&
    (ragPolicyTiers as readonly string[]).includes(value)
  );
}
