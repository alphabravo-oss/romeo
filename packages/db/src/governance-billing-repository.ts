import { and, asc, eq, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  billingEventReceipts,
  billingPlans,
  quotaBuckets,
  retentionPolicies,
} from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type QuotaMetricRecord =
  | "image.cost.micro_usd"
  | "image.generated"
  | "web.search.request"
  | "web.url.fetch"
  | "run.started"
  | "storage.byte"
  | "tool.call";
export type QuotaScopeTypeRecord =
  | "agent"
  | "api_key"
  | "org"
  | "provider"
  | "user"
  | "workspace";
export type QuotaResetIntervalRecord = "daily" | "monthly" | "none";
export type BillingPlanStatusRecord =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing";
export type BillingPlanSourceRecord = "external" | "manual";

export interface RetentionPolicyRecord {
  orgId: string;
  auditLogRetentionDays: number;
  runEventRetentionDays: number;
  fileRetentionDays: number | null;
  workspaceFileRetentionDays: Record<string, number | null>;
  userFileRetentionDays: Record<string, number | null>;
  updatedBy: string;
  updatedAt: string;
}

export interface BillingPlanQuotaTemplateRecord {
  metric: QuotaMetricRecord;
  limit: number;
  resetInterval: QuotaResetIntervalRecord;
}

export interface BillingPlanRecord {
  id: string;
  orgId: string;
  code: string;
  name: string;
  status: BillingPlanStatusRecord;
  source: BillingPlanSourceRecord;
  quotaTemplates: BillingPlanQuotaTemplateRecord[];
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEventReceiptRecord {
  id: string;
  orgId: string;
  provider: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  result: {
    plan: BillingPlanRecord;
    quotas: QuotaBucketRecord[];
  };
  createdAt: string;
}

export interface QuotaBucketRecord {
  id: string;
  orgId: string;
  scopeType: QuotaScopeTypeRecord;
  scopeId: string;
  metric: QuotaMetricRecord;
  limit: number;
  used: number;
  resetInterval: QuotaResetIntervalRecord;
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class PgGovernanceBillingRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async getRetentionPolicy(
    orgId: string,
  ): Promise<RetentionPolicyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.orgId, orgId))
      .limit(1);
    return row === undefined ? undefined : toRetentionPolicyRecord(row);
  }

  async upsertRetentionPolicy(
    policy: RetentionPolicyRecord,
  ): Promise<RetentionPolicyRecord> {
    const [row] = await this.db
      .insert(retentionPolicies)
      .values(toRetentionPolicyInsert(policy))
      .onConflictDoUpdate({
        target: retentionPolicies.orgId,
        set: {
          auditLogRetentionDays: policy.auditLogRetentionDays,
          runEventRetentionDays: policy.runEventRetentionDays,
          fileRetentionDays: policy.fileRetentionDays,
          workspaceFileRetentionDays: policy.workspaceFileRetentionDays,
          userFileRetentionDays: policy.userFileRetentionDays,
          updatedBy: policy.updatedBy,
          updatedAt: new Date(policy.updatedAt),
        },
      })
      .returning();
    return row === undefined ? policy : toRetentionPolicyRecord(row);
  }

  async listQuotaBuckets(orgId: string): Promise<QuotaBucketRecord[]> {
    const rows = await this.db
      .select()
      .from(quotaBuckets)
      .where(eq(quotaBuckets.orgId, orgId))
      .orderBy(
        asc(quotaBuckets.metric),
        asc(quotaBuckets.scopeType),
        asc(quotaBuckets.scopeId),
      );
    return rows.map(toQuotaBucketRecord);
  }

  async createQuotaBucket(
    bucket: QuotaBucketRecord,
  ): Promise<QuotaBucketRecord> {
    const [row] = await this.db
      .insert(quotaBuckets)
      .values(toQuotaBucketInsert(bucket))
      .returning();
    return row === undefined ? bucket : toQuotaBucketRecord(row);
  }

  async updateQuotaBucket(
    bucket: QuotaBucketRecord,
  ): Promise<QuotaBucketRecord> {
    const [row] = await this.db
      .update(quotaBuckets)
      .set({
        limit: bucket.limit,
        metric: bucket.metric,
        resetAt: optionalDate(bucket.resetAt),
        resetInterval: bucket.resetInterval,
        scopeId: bucket.scopeId,
        scopeType: bucket.scopeType,
        updatedAt: new Date(bucket.updatedAt),
        used: bucket.used,
      })
      .where(eq(quotaBuckets.id, bucket.id))
      .returning();
    return row === undefined ? bucket : toQuotaBucketRecord(row);
  }

  async deleteQuotaBucket(
    quotaBucketId: string,
  ): Promise<QuotaBucketRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(quotaBuckets)
      .where(eq(quotaBuckets.id, quotaBucketId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(quotaBuckets)
      .where(eq(quotaBuckets.id, quotaBucketId));
    return toQuotaBucketRecord(existing);
  }

  async getBillingPlan(orgId: string): Promise<BillingPlanRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(billingPlans)
      .where(eq(billingPlans.orgId, orgId))
      .limit(1);
    return row === undefined ? undefined : toBillingPlanRecord(row);
  }

  async acquireBillingSyncLock(orgId: string): Promise<void> {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`romeo:billing:${orgId}`}))`,
    );
  }

  async getBillingEventReceipt(
    orgId: string,
    provider: string,
    eventId: string,
  ): Promise<BillingEventReceiptRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(billingEventReceipts)
      .where(
        and(
          eq(billingEventReceipts.orgId, orgId),
          eq(billingEventReceipts.provider, provider),
          eq(billingEventReceipts.eventId, eventId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toBillingEventReceiptRecord(row);
  }

  async createBillingEventReceipt(
    receipt: BillingEventReceiptRecord,
  ): Promise<BillingEventReceiptRecord> {
    const [row] = await this.db
      .insert(billingEventReceipts)
      .values({
        id: receipt.id,
        orgId: receipt.orgId,
        provider: receipt.provider,
        eventId: receipt.eventId,
        eventType: receipt.eventType,
        occurredAt: new Date(receipt.occurredAt),
        result: receipt.result,
        createdAt: new Date(receipt.createdAt),
      })
      .onConflictDoNothing({
        target: [
          billingEventReceipts.orgId,
          billingEventReceipts.provider,
          billingEventReceipts.eventId,
        ],
      })
      .returning();
    if (row !== undefined) return toBillingEventReceiptRecord(row);
    const existing = await this.getBillingEventReceipt(
      receipt.orgId,
      receipt.provider,
      receipt.eventId,
    );
    if (existing === undefined)
      throw new Error("Billing event receipt conflict was not readable.");
    return existing;
  }

  async upsertBillingPlan(plan: BillingPlanRecord): Promise<BillingPlanRecord> {
    const [row] = await this.db
      .insert(billingPlans)
      .values(toBillingPlanInsert(plan))
      .onConflictDoUpdate({
        target: billingPlans.orgId,
        set: {
          code: plan.code,
          externalCustomerId: plan.externalCustomerId ?? null,
          externalSubscriptionId: plan.externalSubscriptionId ?? null,
          metadata: plan.metadata,
          name: plan.name,
          quotaTemplates: plan.quotaTemplates,
          source: plan.source,
          status: plan.status,
          updatedAt: new Date(plan.updatedAt),
        },
      })
      .returning();
    return row === undefined ? plan : toBillingPlanRecord(row);
  }
}

export function toRetentionPolicyRecord(
  row: typeof retentionPolicies.$inferSelect,
): RetentionPolicyRecord {
  return {
    orgId: row.orgId,
    auditLogRetentionDays: row.auditLogRetentionDays,
    runEventRetentionDays: row.runEventRetentionDays,
    fileRetentionDays: row.fileRetentionDays,
    workspaceFileRetentionDays: retentionOverrideMap(
      row.workspaceFileRetentionDays,
    ),
    userFileRetentionDays: retentionOverrideMap(row.userFileRetentionDays),
    updatedBy: row.updatedBy,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toQuotaBucketRecord(
  row: typeof quotaBuckets.$inferSelect,
): QuotaBucketRecord {
  const bucket: QuotaBucketRecord = {
    id: row.id,
    orgId: row.orgId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    metric: asQuotaMetric(row.metric),
    limit: row.limit,
    used: row.used,
    resetInterval: asQuotaResetInterval(row.resetInterval),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const resetAt = optionalIsoString(row.resetAt);
  if (resetAt !== undefined) bucket.resetAt = resetAt;
  return bucket;
}

export function toBillingPlanRecord(
  row: typeof billingPlans.$inferSelect,
): BillingPlanRecord {
  const plan: BillingPlanRecord = {
    id: row.id,
    orgId: row.orgId,
    code: row.code,
    name: row.name,
    status: asBillingPlanStatus(row.status),
    source: asBillingPlanSource(row.source),
    quotaTemplates: asBillingPlanQuotaTemplates(row.quotaTemplates),
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const externalCustomerId = optionalIsoString(row.externalCustomerId);
  if (externalCustomerId !== undefined)
    plan.externalCustomerId = externalCustomerId;
  const externalSubscriptionId = optionalIsoString(row.externalSubscriptionId);
  if (externalSubscriptionId !== undefined)
    plan.externalSubscriptionId = externalSubscriptionId;
  return plan;
}

export function toBillingEventReceiptRecord(
  row: typeof billingEventReceipts.$inferSelect,
): BillingEventReceiptRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    provider: row.provider,
    eventId: row.eventId,
    eventType: row.eventType,
    occurredAt: toIsoString(row.occurredAt),
    result: row.result as BillingEventReceiptRecord["result"],
    createdAt: toIsoString(row.createdAt),
  };
}

function toRetentionPolicyInsert(
  record: RetentionPolicyRecord,
): typeof retentionPolicies.$inferInsert {
  return {
    orgId: record.orgId,
    auditLogRetentionDays: record.auditLogRetentionDays,
    runEventRetentionDays: record.runEventRetentionDays,
    fileRetentionDays: record.fileRetentionDays,
    workspaceFileRetentionDays: record.workspaceFileRetentionDays,
    userFileRetentionDays: record.userFileRetentionDays,
    updatedBy: record.updatedBy,
    updatedAt: new Date(record.updatedAt),
  };
}

function retentionOverrideMap(value: unknown): Record<string, number | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number | null] =>
        entry[1] === null ||
        (typeof entry[1] === "number" &&
          Number.isInteger(entry[1]) &&
          entry[1] >= 1 &&
          entry[1] <= 3650),
    ),
  );
}

function toQuotaBucketInsert(
  record: QuotaBucketRecord,
): typeof quotaBuckets.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    metric: record.metric,
    limit: record.limit,
    used: record.used,
    resetInterval: record.resetInterval,
    resetAt: optionalDate(record.resetAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toBillingPlanInsert(
  record: BillingPlanRecord,
): typeof billingPlans.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    code: record.code,
    name: record.name,
    status: record.status,
    source: record.source,
    quotaTemplates: record.quotaTemplates as unknown as Array<
      Record<string, unknown>
    >,
    metadata: record.metadata,
    externalCustomerId: record.externalCustomerId ?? null,
    externalSubscriptionId: record.externalSubscriptionId ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function asBillingPlanQuotaTemplates(
  value: unknown,
): BillingPlanQuotaTemplateRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asBillingPlanQuotaTemplate)
    .filter(
      (template): template is BillingPlanQuotaTemplateRecord =>
        template !== undefined,
    );
}

function asBillingPlanQuotaTemplate(
  value: unknown,
): BillingPlanQuotaTemplateRecord | undefined {
  const record = asJsonRecord(value);
  if (typeof record.limit !== "number" || typeof record.metric !== "string")
    return undefined;
  return {
    metric: asQuotaMetric(record.metric),
    limit: Math.max(0, Math.trunc(record.limit)),
    resetInterval: asQuotaResetInterval(record.resetInterval),
  };
}

function asQuotaMetric(value: unknown): QuotaMetricRecord {
  if (
    value === "image.cost.micro_usd" ||
    value === "image.generated" ||
    value === "web.search.request" ||
    value === "web.url.fetch" ||
    value === "run.started" ||
    value === "storage.byte" ||
    value === "tool.call"
  ) {
    return value;
  }
  return "run.started";
}

function asQuotaResetInterval(value: unknown): QuotaResetIntervalRecord {
  if (value === "daily" || value === "monthly" || value === "none")
    return value;
  return "none";
}

function asBillingPlanStatus(value: string): BillingPlanStatusRecord {
  if (
    value === "active" ||
    value === "canceled" ||
    value === "past_due" ||
    value === "trialing"
  ) {
    return value;
  }
  return "past_due";
}

function asBillingPlanSource(value: string): BillingPlanSourceRecord {
  if (value === "external" || value === "manual") return value;
  return "manual";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
