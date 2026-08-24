import type {
  ContentPolicyDecisionRecord,
  PolicyApprovalRecord,
  TransitionPolicyApprovalInput,
} from "../domain/content-policy";
import { append } from "./collection-helpers";
import { InMemoryInventoriedTableRepository } from "./in-memory-inventoried-table";

export abstract class InMemoryContentPolicyRepository extends InMemoryInventoriedTableRepository {
  async listContentPolicyDecisions(
    orgId: string,
    limit: number,
  ): Promise<ContentPolicyDecisionRecord[]> {
    return this.data.contentPolicyDecisions
      .filter((decision) => decision.orgId === orgId)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))
      .slice(0, Math.max(0, limit))
      .map((decision) => structuredClone(decision));
  }

  async getContentPolicyDecision(
    orgId: string,
    decisionId: string,
  ): Promise<ContentPolicyDecisionRecord | undefined> {
    const decision = this.data.contentPolicyDecisions.find(
      (candidate) => candidate.orgId === orgId && candidate.id === decisionId,
    );
    return decision === undefined ? undefined : structuredClone(decision);
  }

  async createContentPolicyDecision(
    decision: ContentPolicyDecisionRecord,
  ): Promise<ContentPolicyDecisionRecord> {
    if (
      this.data.contentPolicyDecisions.some(
        (candidate) =>
          candidate.orgId === decision.orgId && candidate.id === decision.id,
      )
    )
      throw new Error(`Content policy decision ${decision.id} already exists.`);
    append(this.data.contentPolicyDecisions, structuredClone(decision));
    return structuredClone(decision);
  }

  async listContentPolicyApprovals(
    orgId: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]> {
    return this.data.contentPolicyApprovals
      .filter((approval) => approval.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(0, limit))
      .map((approval) => structuredClone(approval));
  }

  async listPendingContentPolicyApprovalsDue(
    orgId: string,
    asOf: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]> {
    return this.data.contentPolicyApprovals
      .filter(
        (approval) =>
          approval.orgId === orgId &&
          approval.state === "pending" &&
          approval.expiresAt <= asOf,
      )
      .sort(
        (left, right) =>
          left.expiresAt.localeCompare(right.expiresAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(0, limit))
      .map((approval) => structuredClone(approval));
  }

  async getContentPolicyApproval(
    orgId: string,
    approvalId: string,
  ): Promise<PolicyApprovalRecord | undefined> {
    const approval = this.data.contentPolicyApprovals.find(
      (candidate) => candidate.orgId === orgId && candidate.id === approvalId,
    );
    return approval === undefined ? undefined : structuredClone(approval);
  }

  async createContentPolicyApproval(
    approval: PolicyApprovalRecord,
  ): Promise<PolicyApprovalRecord> {
    if (
      this.data.contentPolicyApprovals.some(
        (candidate) =>
          candidate.orgId === approval.orgId && candidate.id === approval.id,
      )
    )
      throw new Error(`Content policy approval ${approval.id} already exists.`);
    append(this.data.contentPolicyApprovals, structuredClone(approval));
    return structuredClone(approval);
  }

  async transitionContentPolicyApproval(
    input: TransitionPolicyApprovalInput,
  ): Promise<PolicyApprovalRecord | undefined> {
    const index = this.data.contentPolicyApprovals.findIndex(
      (approval) =>
        approval.orgId === input.orgId &&
        approval.id === input.approvalId &&
        approval.state === input.expectedState,
    );
    if (index < 0) return undefined;
    const current = this.data.contentPolicyApprovals[index]!;
    const resolved: PolicyApprovalRecord = {
      ...current,
      state: input.nextState,
      resolvedAt: input.resolvedAt,
      ...(input.resolvedBy === undefined
        ? {}
        : { resolvedBy: input.resolvedBy }),
    };
    this.data.contentPolicyApprovals[index] = structuredClone(resolved);
    return structuredClone(resolved);
  }
}
