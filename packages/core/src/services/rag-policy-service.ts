import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  ragPolicyExternalVectorDrStrategies,
  ragPolicyExternalVectorExportPolicies,
  ragPolicyExternalVectorModes,
  ragPolicyPhysicalVectorIsolationEnforcements,
  ragPolicyPhysicalVectorIsolationModes,
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  ragPolicyTiers,
  ragVectorIsolationPolicies,
  type CreateRagPolicyChangeRequest,
  type RagPolicyChangeEvidenceSummary,
  type RagPolicyChangeJustificationCode,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
  type RagPolicyExternalVectorStore,
  type RagPolicyPhysicalVectorIsolation,
  type RagPolicyBudgetMap,
  type RagPolicyKnowledgeBaseTierAssignments,
  type RagPolicyProviderModel,
  type RagPolicyReport,
  type RagPolicyTier,
  type UpdateRagPolicyRequest,
} from "../domain/rag-policy";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";

const settingKeyPrefix = "rag_policy.org.v1:";
const changeRequestSettingKeyPrefix = "rag_policy.change_request.org.v1:";

const defaultBudget: RagPolicyBudgetMap = {
  user_private: 5,
  workspace: 5,
  org: 5,
  shared: 5,
};

const defaultMaxBudget: RagPolicyBudgetMap = {
  user_private: 20,
  workspace: 20,
  org: 20,
  shared: 20,
};

interface StoredRagPolicy {
  version: 1;
  orgId: string;
  enabledTiers: RagPolicyTier[];
  defaultMaxResultsPerTier: RagPolicyBudgetMap;
  maxResultsPerTier: RagPolicyBudgetMap;
  allowedEmbeddingProviderModels: RagPolicyProviderModel[];
  knowledgeBaseTierAssignments: RagPolicyKnowledgeBaseTierAssignments;
  dataResidencyTags: string[];
  externalVectorStore: StoredExternalVectorStorePolicy;
  physicalVectorIsolation: StoredPhysicalVectorIsolationPolicy;
  updatedAt?: string;
  updatedBy?: string;
}

type StoredExternalVectorStorePolicy = Omit<
  RagPolicyExternalVectorStore,
  "configured" | "restoreValidation"
>;

type StoredPhysicalVectorIsolationPolicy = Omit<
  RagPolicyPhysicalVectorIsolation,
  "configured" | "liveEvidenceRequired" | "postgresAuthoritative"
>;

export class RagPolicyService {
  constructor(private readonly repository: RomeoRepository) {}

  async report(subject: AuthSubject): Promise<RagPolicyReport> {
    assertScope(subject, "admin:read");
    return readRagPolicy(this.repository, subject.orgId);
  }

  async update(input: {
    subject: AuthSubject;
    policy: UpdateRagPolicyRequest;
  }): Promise<RagPolicyReport> {
    assertScope(input.subject, "admin:write");
    if (isEmptyPolicyPatch(input.policy)) {
      throw new ApiError(
        "rag_policy_empty_update",
        "RAG policy update must include at least one field.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const existing = await readStoredRagPolicy(
        repository,
        input.subject.orgId,
      );
      const previous = toReport(input.subject.orgId, existing);
      const now = new Date().toISOString();
      const updated = applyPolicyPatch(
        existing ?? defaultStoredPolicy(input.subject.orgId),
        input.policy,
        now,
        input.subject.id,
      );
      await repository.upsertSystemSetting({
        key: settingKey(input.subject.orgId),
        value: serializeStoredPolicy(updated),
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.rag_policy.update",
        resourceType: "rag_policy",
        resourceId: input.subject.orgId,
        metadata: policyAuditMetadata(
          previous,
          toReport(input.subject.orgId, updated),
        ),
      });
      return toReport(input.subject.orgId, updated);
    });
  }

  async changeRequest(
    subject: AuthSubject,
  ): Promise<RagPolicyChangeRequest | null> {
    assertScope(subject, "admin:read");
    return readStoredRagPolicyChangeRequest(this.repository, subject.orgId);
  }

  async createChangeRequest(input: {
    subject: AuthSubject;
    change: CreateRagPolicyChangeRequest;
  }): Promise<RagPolicyChangeRequest> {
    assertScope(input.subject, "admin:write");
    if (isEmptyPolicyPatch(input.change.policy)) {
      throw new ApiError(
        "rag_policy_empty_update",
        "RAG policy change request must include at least one policy field.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const existingRequest = await readStoredRagPolicyChangeRequest(
        repository,
        input.subject.orgId,
      );
      if (existingRequest?.status === "pending") {
        throw new ApiError(
          "rag_policy_change_request_pending",
          "A pending RAG policy change request already exists for this organization.",
          409,
          { requestId: existingRequest.requestId },
        );
      }

      const existingPolicy = await readStoredRagPolicy(
        repository,
        input.subject.orgId,
      );
      const before = toReport(input.subject.orgId, existingPolicy);
      const now = new Date().toISOString();
      const proposedStored = applyPolicyPatch(
        existingPolicy ?? defaultStoredPolicy(input.subject.orgId),
        input.change.policy,
        now,
        input.subject.id,
      );
      const proposed = toReport(input.subject.orgId, proposedStored);
      const evidenceSummary = normalizeChangeEvidenceSummary(
        input.change.evidenceSummary,
      );
      const changeRequest: RagPolicyChangeRequest = {
        schema: "romeo.rag-policy-change-request.v1",
        orgId: input.subject.orgId,
        requestId: createId("rag_policy_change"),
        status: "pending",
        requestedBy: input.subject.id,
        requestedAt: now,
        ...(input.change.justificationCode === undefined
          ? {}
          : { justificationCode: input.change.justificationCode }),
        ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
        changedFields: changedPolicyFields(before, proposed),
        policyPatch: input.change.policy,
        before,
        proposed,
        redaction: ragPolicyChangeRedaction(),
      };
      await repository.upsertSystemSetting({
        key: changeRequestSettingKey(input.subject.orgId),
        value: serializeStoredChangeRequest(changeRequest),
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.rag_policy.change_request.create",
        resourceType: "rag_policy",
        resourceId: input.subject.orgId,
        metadata: {
          requestId: changeRequest.requestId,
          changedFields: changeRequest.changedFields,
          justificationCode: changeRequest.justificationCode ?? null,
          evidenceSummary: changeEvidenceAuditMetadata(
            changeRequest.evidenceSummary,
          ),
          ...policyAuditMetadata(before, proposed),
        },
      });
      return changeRequest;
    });
  }

  async approveChangeRequest(input: {
    subject: AuthSubject;
    requestId: string;
    confirmRequestId: string;
  }): Promise<RagPolicyChangeRequest> {
    assertScope(input.subject, "admin:write");
    if (input.confirmRequestId !== input.requestId) {
      throw new ApiError(
        "rag_policy_change_confirmation_mismatch",
        "confirmRequestId must exactly match requestId.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const pending = await requiredPendingChangeRequest(
        repository,
        input.subject.orgId,
        input.requestId,
      );
      const existing = await readStoredRagPolicy(
        repository,
        input.subject.orgId,
      );
      const current = toReport(input.subject.orgId, existing);
      if (!samePolicyReport(current, pending.before)) {
        throw new ApiError(
          "rag_policy_change_request_stale",
          "The RAG policy changed after this request was created.",
          409,
          { requestId: pending.requestId },
        );
      }

      const now = new Date().toISOString();
      const updatedStored = applyPolicyPatch(
        existing ?? defaultStoredPolicy(input.subject.orgId),
        pending.policyPatch,
        now,
        input.subject.id,
      );
      await repository.upsertSystemSetting({
        key: settingKey(input.subject.orgId),
        value: serializeStoredPolicy(updatedStored),
        updatedAt: now,
      });
      const applied = toReport(input.subject.orgId, updatedStored);
      const approved: RagPolicyChangeRequest = {
        ...pending,
        status: "approved",
        reviewedBy: input.subject.id,
        reviewedAt: now,
        applied,
      };
      await repository.upsertSystemSetting({
        key: changeRequestSettingKey(input.subject.orgId),
        value: serializeStoredChangeRequest(approved),
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.rag_policy.change_request.approve",
        resourceType: "rag_policy",
        resourceId: input.subject.orgId,
        metadata: {
          requestId: approved.requestId,
          changedFields: approved.changedFields,
          requesterSameAsApprover: approved.requestedBy === input.subject.id,
          ...policyAuditMetadata(current, applied),
        },
      });
      return approved;
    });
  }

  async rejectChangeRequest(input: {
    subject: AuthSubject;
    requestId: string;
    confirmRequestId: string;
    reasonCode?: RagPolicyChangeRejectReasonCode;
  }): Promise<RagPolicyChangeRequest> {
    assertScope(input.subject, "admin:write");
    if (input.confirmRequestId !== input.requestId) {
      throw new ApiError(
        "rag_policy_change_confirmation_mismatch",
        "confirmRequestId must exactly match requestId.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const pending = await requiredPendingChangeRequest(
        repository,
        input.subject.orgId,
        input.requestId,
      );
      const now = new Date().toISOString();
      const rejected: RagPolicyChangeRequest = {
        ...pending,
        status: "rejected",
        reviewedBy: input.subject.id,
        reviewedAt: now,
        ...(input.reasonCode === undefined
          ? {}
          : { rejectReasonCode: input.reasonCode }),
      };
      await repository.upsertSystemSetting({
        key: changeRequestSettingKey(input.subject.orgId),
        value: serializeStoredChangeRequest(rejected),
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.rag_policy.change_request.reject",
        resourceType: "rag_policy",
        resourceId: input.subject.orgId,
        metadata: {
          requestId: rejected.requestId,
          changedFields: rejected.changedFields,
          reasonCode: rejected.rejectReasonCode ?? null,
        },
      });
      return rejected;
    });
  }
}

export async function readRagPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<RagPolicyReport> {
  return toReport(orgId, await readStoredRagPolicy(repository, orgId));
}

export function isEmbeddingProviderModelAllowed(
  policy: RagPolicyReport,
  providerId: string,
  model: string,
): boolean {
  if (policy.allowedEmbeddingProviderModels.length === 0) return true;
  return policy.allowedEmbeddingProviderModels.some(
    (allowed) => allowed.providerId === providerId && allowed.model === model,
  );
}

export function assertEmbeddingProviderModelAllowed(
  policy: RagPolicyReport,
  providerId: string,
  model: string,
): void {
  if (isEmbeddingProviderModelAllowed(policy, providerId, model)) return;
  throw new ApiError(
    "rag_embedding_provider_model_forbidden",
    "RAG policy does not allow the requested embedding provider/model pair.",
    403,
    {
      allowedEmbeddingProviderModelCount:
        policy.allowedEmbeddingProviderModels.length,
      ragPolicySource: policy.source,
    },
  );
}

function settingKey(orgId: string): string {
  return `${settingKeyPrefix}${orgId}`;
}

function changeRequestSettingKey(orgId: string): string {
  return `${changeRequestSettingKeyPrefix}${orgId}`;
}

async function readStoredRagPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredRagPolicy | undefined> {
  const setting = await repository.getSystemSetting(settingKey(orgId));
  if (setting === undefined) return undefined;
  return parseStoredPolicy(setting.value, orgId);
}

async function readStoredRagPolicyChangeRequest(
  repository: RomeoRepository,
  orgId: string,
): Promise<RagPolicyChangeRequest | null> {
  const setting = await repository.getSystemSetting(
    changeRequestSettingKey(orgId),
  );
  if (setting === undefined) return null;
  return parseStoredChangeRequest(setting.value, orgId);
}

async function requiredPendingChangeRequest(
  repository: RomeoRepository,
  orgId: string,
  requestId: string,
): Promise<RagPolicyChangeRequest> {
  const request = await readStoredRagPolicyChangeRequest(repository, orgId);
  if (request === null || request.requestId !== requestId) {
    throw new ApiError(
      "rag_policy_change_request_not_found",
      "RAG policy change request was not found.",
      404,
    );
  }
  if (request.status !== "pending") {
    throw new ApiError(
      "rag_policy_change_request_not_pending",
      "RAG policy change request is no longer pending.",
      409,
      { requestId },
    );
  }
  return request;
}

function parseStoredPolicy(
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

function parseStoredChangeRequest(
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

function defaultStoredPolicy(orgId: string): StoredRagPolicy {
  return {
    version: 1,
    orgId,
    enabledTiers: defaultTiers(),
    defaultMaxResultsPerTier: { ...defaultBudget },
    maxResultsPerTier: { ...defaultMaxBudget },
    allowedEmbeddingProviderModels: [],
    knowledgeBaseTierAssignments: emptyTierAssignments(),
    dataResidencyTags: [],
    externalVectorStore: defaultExternalVectorStorePolicy(),
    physicalVectorIsolation: defaultPhysicalVectorIsolationPolicy(),
  };
}

function defaultTiers(): RagPolicyTier[] {
  return [...ragPolicyTiers];
}

function applyPolicyPatch(
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

function normalizeTiers(
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

function normalizeBudgetMap(
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

function normalizeProviderModels(value: unknown): RagPolicyProviderModel[] {
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

function emptyTierAssignments(): RagPolicyKnowledgeBaseTierAssignments {
  return { org: [], shared: [] };
}

function cloneTierAssignments(
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

function normalizeTierAssignments(
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

function normalizeTags(value: unknown): string[] {
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

function defaultExternalVectorStorePolicy(): StoredExternalVectorStorePolicy {
  return {
    mode: "disabled",
    namespacePolicy: "none",
    partitioningPolicy: "none",
    drStrategy: "postgres_authoritative_reindex",
    exportPolicy: "metadata_only",
  };
}

function defaultPhysicalVectorIsolationPolicy(): StoredPhysicalVectorIsolationPolicy {
  return {
    mode: "shared_row_scope",
    enforcement: "advisory",
  };
}

function normalizeExternalVectorStore(
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

function normalizePhysicalVectorIsolation(
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

function normalizeEnum<T extends string>(
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

function toReport(
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

function serializeStoredPolicy(
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

function serializeStoredChangeRequest(
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

function externalVectorStoreReport(
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

function physicalVectorIsolationReport(
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

function normalizeChangeEvidenceSummary(
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

function changeEvidenceAuditMetadata(
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

function ragPolicyChangeRedaction(): RagPolicyChangeRequest["redaction"] {
  return {
    rawQueriesReturned: false,
    rawCorpusReturned: false,
    rawChunkTextReturned: false,
    rawVectorValuesReturned: false,
    secretRefsReturned: false,
  };
}

function samePolicyReport(
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

function policyAuditMetadata(
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

function changedPolicyFields(
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

function isEmptyPolicyPatch(policy: UpdateRagPolicyRequest): boolean {
  return (
    policy.enabledTiers === undefined &&
    policy.defaultMaxResultsPerTier === undefined &&
    policy.maxResultsPerTier === undefined &&
    policy.allowedEmbeddingProviderModels === undefined &&
    policy.knowledgeBaseTierAssignments === undefined &&
    policy.dataResidencyTags === undefined &&
    policy.externalVectorStore === undefined &&
    policy.physicalVectorIsolation === undefined
  );
}
