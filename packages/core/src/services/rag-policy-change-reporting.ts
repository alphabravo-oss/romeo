import {
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  ragPolicyTiers,
  type RagPolicyChangeEvidenceSummary,
  type RagPolicyChangeJustificationCode,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
  type RagPolicyBudgetMap,
  type RagPolicyReport,
  type UpdateRagPolicyRequest,
} from "../domain/rag-policy";
import {
  defaultExternalVectorStorePolicy,
  defaultPhysicalVectorIsolationPolicy,
  defaultTiers,
  normalizeBudgetMap,
  normalizeEnum,
  normalizeAgenticSettings,
  normalizeExternalVectorStore,
  normalizePhysicalVectorIsolation,
  normalizeProviderModels,
  normalizeRetrievalSettings,
  normalizeTags,
  normalizeTierAssignments,
  normalizeTiers,
} from "./rag-policy-normalization";
import { defaultBudget, defaultMaxBudget } from "./rag-policy-types";
import {
  externalVectorStoreReport,
  physicalVectorIsolationReport,
  toReport,
} from "./rag-policy-reporting";

export function parseStoredChangeRequest(
  value: Record<string, unknown>,
  orgId: string,
): RagPolicyChangeRequest | null {
  if (value.version !== 1 || value.orgId !== orgId) return null;
  const requestId = optionalString(value.requestId);
  const status = normalizeEnum(
    value.status,
    ["approved", "pending", "rejected"] as const,
    "rejected",
  );
  const requestedBy = optionalString(value.requestedBy);
  const requestedAt = optionalString(value.requestedAt);
  if (
    requestId === undefined ||
    requestedBy === undefined ||
    requestedAt === undefined
  ) {
    return null;
  }
  const before = parsePolicyReport(value.before, orgId);
  const proposed = parsePolicyReport(value.proposed, orgId);
  const applied = parseOptionalPolicyReport(value.applied, orgId);
  const policyPatch = normalizePolicyPatch(value.policyPatch);
  const reviewedBy = optionalString(value.reviewedBy);
  const reviewedAt = optionalString(value.reviewedAt);
  const evidenceSummary = normalizeChangeEvidenceSummary(value.evidenceSummary);
  return {
    schema: "romeo.rag-policy-change-request.v1",
    orgId,
    requestId,
    status,
    requestedBy,
    requestedAt,
    ...(reviewedBy === undefined ? {} : { reviewedBy }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
    ...(isRejectReasonCode(value.rejectReasonCode)
      ? { rejectReasonCode: value.rejectReasonCode }
      : {}),
    ...(isJustificationCode(value.justificationCode)
      ? { justificationCode: value.justificationCode }
      : {}),
    ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
    changedFields: Array.isArray(value.changedFields)
      ? value.changedFields.filter(
          (field): field is string => typeof field === "string",
        )
      : changedPolicyFields(before, proposed),
    policyPatch,
    before,
    proposed,
    ...(applied === undefined ? {} : { applied }),
    redaction: ragPolicyChangeRedaction(),
  };
}

function normalizePolicyPatch(value: unknown): UpdateRagPolicyRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const patch: UpdateRagPolicyRequest = {};
  if (input.enabledTiers !== undefined) {
    patch.enabledTiers = normalizeTiers(input.enabledTiers, []);
  }
  if (input.defaultMaxResultsPerTier !== undefined) {
    patch.defaultMaxResultsPerTier = normalizePartialBudgetMap(
      input.defaultMaxResultsPerTier,
    );
  }
  if (input.maxResultsPerTier !== undefined) {
    patch.maxResultsPerTier = normalizePartialBudgetMap(
      input.maxResultsPerTier,
    );
  }
  if (input.allowedEmbeddingProviderModels !== undefined) {
    patch.allowedEmbeddingProviderModels = normalizeProviderModels(
      input.allowedEmbeddingProviderModels,
    );
  }
  if (input.retrieval !== undefined) {
    patch.retrieval = normalizeRetrievalSettings(input.retrieval);
  }
  if (input.agentic !== undefined) {
    patch.agentic = normalizeAgenticSettings(input.agentic);
  }
  if (input.knowledgeBaseTierAssignments !== undefined) {
    patch.knowledgeBaseTierAssignments = normalizeTierAssignments(
      input.knowledgeBaseTierAssignments,
    );
  }
  if (input.dataResidencyTags !== undefined) {
    patch.dataResidencyTags = normalizeTags(input.dataResidencyTags);
  }
  if (input.externalVectorStore !== undefined) {
    patch.externalVectorStore = normalizeExternalVectorStore(
      input.externalVectorStore,
      defaultExternalVectorStorePolicy(),
    );
  }
  if (input.physicalVectorIsolation !== undefined) {
    patch.physicalVectorIsolation = normalizePhysicalVectorIsolation(
      input.physicalVectorIsolation,
      defaultPhysicalVectorIsolationPolicy(),
    );
  }
  return patch;
}

function normalizePartialBudgetMap(
  value: unknown,
): Partial<RagPolicyBudgetMap> {
  const full = normalizeBudgetMap(value, defaultBudget);
  const partial: Partial<RagPolicyBudgetMap> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return partial;
  }
  const input = value as Record<string, unknown>;
  for (const tier of ragPolicyTiers) {
    if (input[tier] !== undefined) partial[tier] = full[tier];
  }
  return partial;
}

function parsePolicyReport(value: unknown, orgId: string): RagPolicyReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return toReport(orgId, undefined);
  }
  const input = value as Record<string, unknown>;
  return {
    orgId,
    source: input.source === "org" ? "org" : "default",
    enabledTiers: normalizeTiers(input.enabledTiers, defaultTiers()),
    defaultMaxResultsPerTier: normalizeBudgetMap(
      input.defaultMaxResultsPerTier,
      defaultBudget,
    ),
    maxResultsPerTier: normalizeBudgetMap(
      input.maxResultsPerTier,
      defaultMaxBudget,
    ),
    allowedEmbeddingProviderModels: normalizeProviderModels(
      input.allowedEmbeddingProviderModels,
    ),
    retrieval: normalizeRetrievalSettings(input.retrieval),
    agentic: normalizeAgenticSettings(input.agentic),
    knowledgeBaseTierAssignments: normalizeTierAssignments(
      input.knowledgeBaseTierAssignments,
    ),
    dataResidencyTags: normalizeTags(input.dataResidencyTags),
    externalVectorStore: externalVectorStoreReport(
      normalizeExternalVectorStore(
        input.externalVectorStore,
        defaultExternalVectorStorePolicy(),
      ),
    ),
    physicalVectorIsolation: physicalVectorIsolationReport(
      normalizePhysicalVectorIsolation(
        input.physicalVectorIsolation,
        defaultPhysicalVectorIsolationPolicy(),
      ),
    ),
    retention: {
      deleteVectorsOnSourceDelete: true,
      exportIncludesEmbeddingVectors: false,
    },
    enforcement: {
      tierBudgets: "enforced",
      embeddingProviderModelAllowlist:
        Array.isArray(input.allowedEmbeddingProviderModels) &&
        input.allowedEmbeddingProviderModels.length > 0
          ? "enforced"
          : "unrestricted",
    },
    ...(optionalString(input.updatedAt) === undefined
      ? {}
      : { updatedAt: optionalString(input.updatedAt)! }),
    ...(optionalString(input.updatedBy) === undefined
      ? {}
      : { updatedBy: optionalString(input.updatedBy)! }),
  };
}

function parseOptionalPolicyReport(
  value: unknown,
  orgId: string,
): RagPolicyReport | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePolicyReport(value, orgId);
}

export function normalizeChangeEvidenceSummary(
  value: unknown,
): RagPolicyChangeEvidenceSummary | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const summary: RagPolicyChangeEvidenceSummary = {};
  const replayCaseCount = optionalNonNegativeInteger(input.replayCaseCount);
  const averagePrecision = optionalRatio(input.averagePrecision);
  const averageRecall = optionalRatio(input.averageRecall);
  const averageLatencyMs = optionalNonNegativeNumber(input.averageLatencyMs);
  if (replayCaseCount !== undefined) summary.replayCaseCount = replayCaseCount;
  if (averagePrecision !== undefined)
    summary.averagePrecision = averagePrecision;
  if (averageRecall !== undefined) summary.averageRecall = averageRecall;
  if (averageLatencyMs !== undefined)
    summary.averageLatencyMs = averageLatencyMs;
  if (typeof input.beforeAfterComparisonAttached === "boolean") {
    summary.beforeAfterComparisonAttached = input.beforeAfterComparisonAttached;
  }
  return Object.keys(summary).length === 0 ? undefined : summary;
}

export function changeEvidenceAuditMetadata(
  summary: RagPolicyChangeEvidenceSummary | undefined,
): Record<string, unknown> {
  return {
    provided: summary !== undefined,
    replayCaseCount: summary?.replayCaseCount ?? null,
    averagePrecision: summary?.averagePrecision ?? null,
    averageRecall: summary?.averageRecall ?? null,
    averageLatencyMs: summary?.averageLatencyMs ?? null,
    beforeAfterComparisonAttached:
      summary?.beforeAfterComparisonAttached ?? false,
  };
}

export function ragPolicyChangeRedaction(): RagPolicyChangeRequest["redaction"] {
  return {
    rawQueriesReturned: false,
    rawCorpusReturned: false,
    rawChunkTextReturned: false,
    rawVectorValuesReturned: false,
    secretRefsReturned: false,
  };
}

export function samePolicyReport(
  left: RagPolicyReport,
  right: RagPolicyReport,
): boolean {
  return (
    JSON.stringify(policyComparable(left)) ===
    JSON.stringify(policyComparable(right))
  );
}

function policyComparable(policy: RagPolicyReport): Record<string, unknown> {
  return {
    source: policy.source,
    enabledTiers: policy.enabledTiers,
    defaultMaxResultsPerTier: policy.defaultMaxResultsPerTier,
    maxResultsPerTier: policy.maxResultsPerTier,
    allowedEmbeddingProviderModels: policy.allowedEmbeddingProviderModels,
    retrieval: policy.retrieval,
    knowledgeBaseTierAssignments: policy.knowledgeBaseTierAssignments,
    dataResidencyTags: policy.dataResidencyTags,
    externalVectorStore: policy.externalVectorStore,
    physicalVectorIsolation: policy.physicalVectorIsolation,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function optionalRatio(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}

function isJustificationCode(
  value: unknown,
): value is RagPolicyChangeJustificationCode {
  return (
    typeof value === "string" &&
    (ragPolicyChangeJustificationCodes as readonly string[]).includes(value)
  );
}

function isRejectReasonCode(
  value: unknown,
): value is RagPolicyChangeRejectReasonCode {
  return (
    typeof value === "string" &&
    (ragPolicyChangeRejectReasonCodes as readonly string[]).includes(value)
  );
}

export function policyAuditMetadata(
  before: RagPolicyReport,
  after: RagPolicyReport,
): Record<string, unknown> {
  return {
    changedFields: changedPolicyFields(before, after),
    enabledTierCount: after.enabledTiers.length,
    allowedEmbeddingProviderModelCount:
      after.allowedEmbeddingProviderModels.length,
    assignedKnowledgeBaseCounts: {
      org: after.knowledgeBaseTierAssignments.org.length,
      shared: after.knowledgeBaseTierAssignments.shared.length,
    },
    dataResidencyTagCount: after.dataResidencyTags.length,
    externalVectorStore: {
      mode: after.externalVectorStore.mode,
      namespacePolicy: after.externalVectorStore.namespacePolicy,
      partitioningPolicy: after.externalVectorStore.partitioningPolicy,
      drStrategy: after.externalVectorStore.drStrategy,
      exportPolicy: after.externalVectorStore.exportPolicy,
      restoreValidation: after.externalVectorStore.restoreValidation,
    },
    physicalVectorIsolation: {
      mode: after.physicalVectorIsolation.mode,
      enforcement: after.physicalVectorIsolation.enforcement,
      liveEvidenceRequired: after.physicalVectorIsolation.liveEvidenceRequired,
    },
    source: after.source,
  };
}

export function changedPolicyFields(
  before: RagPolicyReport,
  after: RagPolicyReport,
): string[] {
  const fields: string[] = [];
  if (before.enabledTiers.join(",") !== after.enabledTiers.join(",")) {
    fields.push("enabledTiers");
  }
  if (
    JSON.stringify(before.defaultMaxResultsPerTier) !==
    JSON.stringify(after.defaultMaxResultsPerTier)
  ) {
    fields.push("defaultMaxResultsPerTier");
  }
  if (
    JSON.stringify(before.maxResultsPerTier) !==
    JSON.stringify(after.maxResultsPerTier)
  ) {
    fields.push("maxResultsPerTier");
  }
  if (
    JSON.stringify(before.allowedEmbeddingProviderModels) !==
    JSON.stringify(after.allowedEmbeddingProviderModels)
  ) {
    fields.push("allowedEmbeddingProviderModels");
  }
  if (JSON.stringify(before.retrieval) !== JSON.stringify(after.retrieval)) {
    fields.push("retrieval");
  }
  if (JSON.stringify(before.agentic) !== JSON.stringify(after.agentic)) {
    fields.push("agentic");
  }
  if (
    JSON.stringify(before.knowledgeBaseTierAssignments) !==
    JSON.stringify(after.knowledgeBaseTierAssignments)
  ) {
    fields.push("knowledgeBaseTierAssignments");
  }
  if (
    before.dataResidencyTags.join(",") !== after.dataResidencyTags.join(",")
  ) {
    fields.push("dataResidencyTags");
  }
  if (
    JSON.stringify(before.externalVectorStore) !==
    JSON.stringify(after.externalVectorStore)
  ) {
    fields.push("externalVectorStore");
  }
  if (
    JSON.stringify(before.physicalVectorIsolation) !==
    JSON.stringify(after.physicalVectorIsolation)
  ) {
    fields.push("physicalVectorIsolation");
  }
  return fields;
}

export function isEmptyPolicyPatch(policy: UpdateRagPolicyRequest): boolean {
  return (
    policy.enabledTiers === undefined &&
    policy.defaultMaxResultsPerTier === undefined &&
    policy.maxResultsPerTier === undefined &&
    policy.allowedEmbeddingProviderModels === undefined &&
    policy.retrieval === undefined &&
    policy.agentic === undefined &&
    policy.knowledgeBaseTierAssignments === undefined &&
    policy.dataResidencyTags === undefined &&
    policy.externalVectorStore === undefined &&
    policy.physicalVectorIsolation === undefined
  );
}
