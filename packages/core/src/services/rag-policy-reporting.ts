import type {
  RagPolicyChangeRequest,
  RagPolicyExternalVectorStore,
  RagPolicyPhysicalVectorIsolation,
  RagPolicyReport,
} from "../domain/rag-policy";
import {
  defaultStoredPolicy,
  cloneTierAssignments,
} from "./rag-policy-normalization";
import type {
  StoredExternalVectorStorePolicy,
  StoredPhysicalVectorIsolationPolicy,
  StoredRagPolicy,
} from "./rag-policy-types";

export function toReport(
  orgId: string,
  stored: StoredRagPolicy | undefined,
): RagPolicyReport {
  const policy = stored ?? defaultStoredPolicy(orgId);
  return {
    orgId,
    source: stored === undefined ? "default" : "org",
    enabledTiers: policy.enabledTiers,
    defaultMaxResultsPerTier: { ...policy.defaultMaxResultsPerTier },
    maxResultsPerTier: { ...policy.maxResultsPerTier },
    allowedEmbeddingProviderModels: policy.allowedEmbeddingProviderModels,
    knowledgeBaseTierAssignments: cloneTierAssignments(
      policy.knowledgeBaseTierAssignments,
    ),
    dataResidencyTags: policy.dataResidencyTags,
    externalVectorStore: externalVectorStoreReport(policy.externalVectorStore),
    physicalVectorIsolation: physicalVectorIsolationReport(
      policy.physicalVectorIsolation,
    ),
    retention: {
      deleteVectorsOnSourceDelete: true,
      exportIncludesEmbeddingVectors: false,
    },
    enforcement: {
      tierBudgets: "enforced",
      embeddingProviderModelAllowlist:
        policy.allowedEmbeddingProviderModels.length > 0
          ? "enforced"
          : "unrestricted",
    },
    ...(policy.updatedAt === undefined ? {} : { updatedAt: policy.updatedAt }),
    ...(policy.updatedBy === undefined ? {} : { updatedBy: policy.updatedBy }),
  };
}

export function serializeStoredPolicy(
  policy: StoredRagPolicy,
): Record<string, unknown> {
  return {
    version: 1,
    orgId: policy.orgId,
    enabledTiers: policy.enabledTiers,
    defaultMaxResultsPerTier: policy.defaultMaxResultsPerTier,
    maxResultsPerTier: policy.maxResultsPerTier,
    allowedEmbeddingProviderModels: policy.allowedEmbeddingProviderModels,
    knowledgeBaseTierAssignments: policy.knowledgeBaseTierAssignments,
    dataResidencyTags: policy.dataResidencyTags,
    externalVectorStore: policy.externalVectorStore,
    physicalVectorIsolation: policy.physicalVectorIsolation,
    updatedAt: policy.updatedAt,
    updatedBy: policy.updatedBy,
  };
}

export function serializeStoredChangeRequest(
  request: RagPolicyChangeRequest,
): Record<string, unknown> {
  return {
    version: 1,
    orgId: request.orgId,
    requestId: request.requestId,
    status: request.status,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt,
    rejectReasonCode: request.rejectReasonCode,
    justificationCode: request.justificationCode,
    evidenceSummary: request.evidenceSummary,
    changedFields: request.changedFields,
    policyPatch: request.policyPatch,
    before: request.before,
    proposed: request.proposed,
    applied: request.applied,
  };
}

export function externalVectorStoreReport(
  policy: StoredExternalVectorStorePolicy,
): RagPolicyExternalVectorStore {
  const configured =
    policy.mode === "deployment_managed" && policy.namespacePolicy !== "none";
  return {
    ...policy,
    configured,
    restoreValidation: configured ? "required_when_enabled" : "not_required",
  };
}

export function physicalVectorIsolationReport(
  policy: StoredPhysicalVectorIsolationPolicy,
): RagPolicyPhysicalVectorIsolation {
  const configured = policy.mode !== "shared_row_scope";
  return {
    ...policy,
    configured,
    postgresAuthoritative: true,
    liveEvidenceRequired: configured,
  };
}
