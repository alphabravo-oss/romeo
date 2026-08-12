import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  type CreateRagPolicyChangeRequest,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
  type RagPolicyReport,
  type UpdateRagPolicyRequest,
} from "../domain/rag-policy";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  applyPolicyPatch,
  defaultStoredPolicy,
} from "./rag-policy-normalization";
import {
  changeEvidenceAuditMetadata,
  changedPolicyFields,
  isEmptyPolicyPatch,
  normalizeChangeEvidenceSummary,
  policyAuditMetadata,
  ragPolicyChangeRedaction,
  samePolicyReport,
} from "./rag-policy-change-reporting";
import {
  serializeStoredChangeRequest,
  serializeStoredPolicy,
  toReport,
} from "./rag-policy-reporting";
import {
  changeRequestSettingKey,
  readStoredRagPolicy,
  readStoredRagPolicyChangeRequest,
  requiredPendingChangeRequest,
  settingKey,
} from "./rag-policy-storage";
import {
  evaluateKnowledgeIngestReadiness,
  type KnowledgeIngestReadiness,
} from "./knowledge-ingest-readiness";

export class RagPolicyService {
  constructor(private readonly repository: RomeoRepository) {}

  async report(subject: AuthSubject): Promise<RagPolicyReport> {
    assertScope(subject, "admin:read");
    return readRagPolicy(this.repository, subject.orgId);
  }

  async agenticSettings(subject: AuthSubject) {
    assertScope(subject, "knowledge:read");
    const policy = await readRagPolicy(this.repository, subject.orgId);
    return { ...policy.agentic };
  }

  async ingestReadiness(subject: AuthSubject): Promise<KnowledgeIngestReadiness> {
    assertScope(subject, "knowledge:read");
    return evaluateKnowledgeIngestReadiness(
      await readRagPolicy(this.repository, subject.orgId),
    );
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
