import type {
  ContentPolicyDecisionRecord,
  PolicyApprovalRecord,
  TransitionPolicyApprovalInput,
} from "@romeo/core";
import { and, asc, desc, eq, lte } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { contentPolicyApprovals, contentPolicyDecisions } from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

export class PgContentPolicyRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listContentPolicyDecisions(
    orgId: string,
    limit: number,
  ): Promise<ContentPolicyDecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(contentPolicyDecisions)
      .where(eq(contentPolicyDecisions.orgId, orgId))
      .orderBy(
        desc(contentPolicyDecisions.decidedAt),
        asc(contentPolicyDecisions.id),
      )
      .limit(Math.max(0, limit));
    return rows.map(toDecisionRecord);
  }

  async getContentPolicyDecision(
    orgId: string,
    decisionId: string,
  ): Promise<ContentPolicyDecisionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(contentPolicyDecisions)
      .where(
        and(
          eq(contentPolicyDecisions.orgId, orgId),
          eq(contentPolicyDecisions.id, decisionId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toDecisionRecord(row);
  }

  async createContentPolicyDecision(
    decision: ContentPolicyDecisionRecord,
  ): Promise<ContentPolicyDecisionRecord> {
    const [row] = await this.db
      .insert(contentPolicyDecisions)
      .values({
        id: decision.id,
        orgId: decision.orgId,
        policyVersionId: decision.policyVersionId,
        surface: decision.surface,
        action: decision.action,
        detectors: decision.detectors,
        runId: decision.runId ?? null,
        executionJobId: decision.executionJobId ?? null,
        decidedAt: new Date(decision.decidedAt),
      })
      .returning();
    return row === undefined ? decision : toDecisionRecord(row);
  }

  async listContentPolicyApprovals(
    orgId: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]> {
    const rows = await this.db
      .select()
      .from(contentPolicyApprovals)
      .where(eq(contentPolicyApprovals.orgId, orgId))
      .orderBy(
        desc(contentPolicyApprovals.createdAt),
        asc(contentPolicyApprovals.id),
      )
      .limit(Math.max(0, limit));
    return rows.map(toApprovalRecord);
  }

  async listPendingContentPolicyApprovalsDue(
    orgId: string,
    asOf: string,
    limit: number,
  ): Promise<PolicyApprovalRecord[]> {
    const rows = await this.db
      .select()
      .from(contentPolicyApprovals)
      .where(
        and(
          eq(contentPolicyApprovals.orgId, orgId),
          eq(contentPolicyApprovals.state, "pending"),
          lte(contentPolicyApprovals.expiresAt, new Date(asOf)),
        ),
      )
      .orderBy(
        asc(contentPolicyApprovals.expiresAt),
        asc(contentPolicyApprovals.id),
      )
      .limit(Math.max(0, limit));
    return rows.map(toApprovalRecord);
  }

  async getContentPolicyApproval(
    orgId: string,
    approvalId: string,
  ): Promise<PolicyApprovalRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(contentPolicyApprovals)
      .where(
        and(
          eq(contentPolicyApprovals.orgId, orgId),
          eq(contentPolicyApprovals.id, approvalId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toApprovalRecord(row);
  }

  async createContentPolicyApproval(
    approval: PolicyApprovalRecord,
  ): Promise<PolicyApprovalRecord> {
    const [row] = await this.db
      .insert(contentPolicyApprovals)
      .values({
        id: approval.id,
        orgId: approval.orgId,
        runId: approval.runId,
        decisionId: approval.decisionId,
        policyVersionId: approval.policyVersionId,
        executionJobId: approval.executionJobId,
        actorId: approval.actorId,
        state: approval.state,
        expiresAt: new Date(approval.expiresAt),
        createdAt: new Date(approval.createdAt),
        resolvedAt:
          approval.resolvedAt === undefined
            ? null
            : new Date(approval.resolvedAt),
        resolvedBy: approval.resolvedBy ?? null,
      })
      .returning();
    return row === undefined ? approval : toApprovalRecord(row);
  }

  async transitionContentPolicyApproval(
    input: TransitionPolicyApprovalInput,
  ): Promise<PolicyApprovalRecord | undefined> {
    const [row] = await this.db
      .update(contentPolicyApprovals)
      .set({
        state: input.nextState,
        resolvedAt: new Date(input.resolvedAt),
        resolvedBy: input.resolvedBy ?? null,
      })
      .where(
        and(
          eq(contentPolicyApprovals.id, input.approvalId),
          eq(contentPolicyApprovals.orgId, input.orgId),
          eq(contentPolicyApprovals.state, input.expectedState),
        ),
      )
      .returning();
    return row === undefined ? undefined : toApprovalRecord(row);
  }
}

function toDecisionRecord(
  row: typeof contentPolicyDecisions.$inferSelect,
): ContentPolicyDecisionRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    policyVersionId: row.policyVersionId,
    surface: row.surface,
    action: decisionAction(row.action),
    detectors: decisionDetectors(row.detectors),
    decidedAt: toIsoString(row.decidedAt),
    ...(row.runId === null ? {} : { runId: row.runId }),
    ...(row.executionJobId === null
      ? {}
      : { executionJobId: row.executionJobId }),
  };
}

function toApprovalRecord(
  row: typeof contentPolicyApprovals.$inferSelect,
): PolicyApprovalRecord {
  const resolvedAt = optionalIsoString(row.resolvedAt);
  return {
    id: row.id,
    orgId: row.orgId,
    runId: row.runId,
    decisionId: row.decisionId,
    policyVersionId: row.policyVersionId,
    ...(row.executionJobId === null
      ? {}
      : { executionJobId: row.executionJobId }),
    actorId: row.actorId,
    state: approvalState(row.state),
    expiresAt: toIsoString(row.expiresAt),
    createdAt: toIsoString(row.createdAt),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(row.resolvedBy === null ? {} : { resolvedBy: row.resolvedBy }),
  };
}

function decisionAction(value: string): ContentPolicyDecisionRecord["action"] {
  if (value === "allow" || value === "audit" || value === "redact")
    return value;
  return "block";
}

function approvalState(value: string): PolicyApprovalRecord["state"] {
  if (value === "approved" || value === "denied" || value === "expired")
    return value;
  return "pending";
}

function decisionDetectors(
  value: unknown,
): ContentPolicyDecisionRecord["detectors"] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ContentPolicyDecisionRecord["detectors"][number] => {
      if (item === null || typeof item !== "object" || Array.isArray(item))
        return false;
      const candidate = item as Record<string, unknown>;
      return (
        (candidate.action === "audit" ||
          candidate.action === "block" ||
          candidate.action === "redact") &&
        (candidate.code === "api_token" ||
          candidate.code === "credit_card" ||
          candidate.code === "email_address" ||
          candidate.code === "us_ssn") &&
        typeof candidate.count === "number" &&
        Number.isSafeInteger(candidate.count) &&
        candidate.count >= 0
      );
    },
  );
}
