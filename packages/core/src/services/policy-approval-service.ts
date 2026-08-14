import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  publicPolicyApproval,
  requestPolicyApproval,
  resolvePolicyApproval,
  type PolicyApprovalRecord,
} from "./policy-approval";

const SCHEMA = "romeo.content-policy.approvals.v1";

export class PolicyApprovalService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject) {
    assertScope(subject, "admin:read");
    return (await this.read(subject.orgId)).map(publicPolicyApproval);
  }

  async request(input: {
    subject: AuthSubject;
    runId: string;
    decisionId: string;
    expiresAt: string;
    matchTextPresent?: boolean;
  }) {
    assertScope(input.subject, "admin:write");
    const now = new Date().toISOString();
    const requested = requestPolicyApproval({
      id: createId("policy_approval"),
      orgId: input.subject.orgId,
      runId: input.runId,
      decisionId: input.decisionId,
      actorId: input.subject.id,
      expiresAt: input.expiresAt,
      now,
      matchTextPresent: input.matchTextPresent === true,
    });
    if (requested.outcome === "denied")
      throw new ApiError(
        requested.code,
        requested.code === "content_policy_approval_expired"
          ? "The policy approval window has expired."
          : "A high-risk policy decision requires a content-minimized approval.",
        requested.code === "content_policy_approval_expired" ? 409 : 403,
      );
    const approvals = [...(await this.read(input.subject.orgId)), requested.approval];
    await this.write(input.subject.orgId, approvals, now);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.content_policy.approval.request",
      resourceType: "content_policy",
      resourceId: requested.approval.id,
      metadata: { runId: input.runId, state: requested.approval.state },
    });
    return publicPolicyApproval(requested.approval);
  }

  async resolve(input: {
    subject: AuthSubject;
    approvalId: string;
    decision: "approve" | "deny";
    runId?: string;
  }) {
    assertScope(input.subject, "admin:write");
    const now = new Date().toISOString();
    const approvals = await this.read(input.subject.orgId);
    const current = approvals.find((item) => item.id === input.approvalId);
    if (current === undefined) throw notFound("Content policy approval");
    const resolved = resolvePolicyApproval({
      approval: current,
      actorId: input.subject.id,
      now,
      decision: input.decision,
      runId: input.runId ?? current.runId,
    });
    if ("code" in resolved)
      throw new ApiError(
        resolved.code,
        resolved.code === "content_policy_approval_scope_mismatch"
          ? "The approval does not apply to this run."
          : "The policy approval is no longer pending.",
        resolved.code === "content_policy_approval_scope_mismatch" ? 403 : 409,
      );
    const next = approvals.map((item) =>
      item.id === resolved.approval.id ? resolved.approval : item,
    );
    await this.write(input.subject.orgId, next, now);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.content_policy.approval.resolve",
      resourceType: "content_policy",
      resourceId: resolved.approval.id,
      metadata: { runId: resolved.approval.runId, state: resolved.approval.state },
    });
    return publicPolicyApproval(resolved.approval);
  }

  private async read(orgId: string): Promise<PolicyApprovalRecord[]> {
    const value = (await this.repository.getSystemSetting(storeKey(orgId)))?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== SCHEMA || candidate.orgId !== orgId) return [];
    return Array.isArray(candidate.approvals)
      ? (candidate.approvals as PolicyApprovalRecord[])
      : [];
  }

  private async write(
    orgId: string,
    approvals: PolicyApprovalRecord[],
    now: string,
  ): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: storeKey(orgId),
      value: { schema: SCHEMA, orgId, approvals },
      updatedAt: now,
    });
  }
}

function storeKey(orgId: string): string {
  return `content_policy.approvals.v1:${orgId}`;
}
