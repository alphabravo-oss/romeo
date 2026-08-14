import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { webhookDeliveries, webhookSubscriptions } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type WebhookEventTypeRecord =
  | "knowledge.source.indexed"
  | "quota.alert"
  | "run.cancelled"
  | "run.completed"
  | "run.failed"
  | "tool.call.failed"
  | "tool.call.succeeded"
  | "webhook.test";
export type WebhookDeliveryStatusRecord = "delivered" | "failed" | "pending";

export interface WebhookSubscriptionRecord {
  id: string;
  orgId: string;
  url: string;
  eventTypes: WebhookEventTypeRecord[];
  disabledAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  orgId: string;
  subscriptionId: string;
  eventType: WebhookEventTypeRecord;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatusRecord;
  attemptCount: number;
  responseStatus?: number;
  errorCode?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryCursorRecord {
  createdAt: string;
  id: string;
}

export interface ClaimedWebhookDeliveryRecord {
  delivery: WebhookDeliveryRecord;
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
}

export class PgWebhookRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listWebhookSubscriptions(
    orgId: string,
  ): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.orgId, orgId))
      .orderBy(
        desc(webhookSubscriptions.createdAt),
        asc(webhookSubscriptions.id),
      );
    return rows.map(toWebhookSubscriptionRecord);
  }

  async getWebhookSubscription(
    subscriptionId: string,
  ): Promise<WebhookSubscriptionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, subscriptionId))
      .limit(1);
    return row === undefined ? undefined : toWebhookSubscriptionRecord(row);
  }

  async createWebhookSubscription(
    subscription: WebhookSubscriptionRecord,
  ): Promise<WebhookSubscriptionRecord> {
    const [row] = await this.db
      .insert(webhookSubscriptions)
      .values(toWebhookSubscriptionInsert(subscription))
      .returning();
    return row === undefined ? subscription : toWebhookSubscriptionRecord(row);
  }

  async updateWebhookSubscription(
    subscription: WebhookSubscriptionRecord,
  ): Promise<WebhookSubscriptionRecord> {
    const [row] = await this.db
      .update(webhookSubscriptions)
      .set({
        disabledAt: optionalDate(subscription.disabledAt),
        eventTypes: subscription.eventTypes,
        updatedAt: new Date(subscription.updatedAt),
        url: subscription.url,
      })
      .where(eq(webhookSubscriptions.id, subscription.id))
      .returning();
    return row === undefined ? subscription : toWebhookSubscriptionRecord(row);
  }

  async listWebhookDeliveries(
    orgId: string,
    subscriptionId?: string,
  ): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        subscriptionId === undefined
          ? eq(webhookDeliveries.orgId, orgId)
          : and(
              eq(webhookDeliveries.orgId, orgId),
              eq(webhookDeliveries.subscriptionId, subscriptionId),
            ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), asc(webhookDeliveries.id));
    return rows.map(toWebhookDeliveryRecord);
  }

  async listWebhookDeliveriesPage(input: {
    cursor?: WebhookDeliveryCursorRecord;
    limit: number;
    orgId: string;
    subscriptionId?: string;
  }): Promise<WebhookDeliveryRecord[]> {
    const cursorWhere =
      input.cursor === undefined
        ? undefined
        : or(
            lt(webhookDeliveries.createdAt, new Date(input.cursor.createdAt)),
            and(
              eq(webhookDeliveries.createdAt, new Date(input.cursor.createdAt)),
              gt(webhookDeliveries.id, input.cursor.id),
            ),
          );
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.orgId, input.orgId),
          input.subscriptionId === undefined
            ? undefined
            : eq(webhookDeliveries.subscriptionId, input.subscriptionId),
          cursorWhere,
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), asc(webhookDeliveries.id))
      .limit(input.limit);
    return rows.map(toWebhookDeliveryRecord);
  }

  async claimWebhookDelivery(input: {
    deliveryId: string;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<ClaimedWebhookDeliveryRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.id, input.deliveryId),
            eq(webhookDeliveries.orgId, input.orgId),
            eq(webhookDeliveries.status, "pending"),
            leaseAvailableAt(input.now),
          ),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await transaction
        .update(webhookDeliveries)
        .set({
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
        })
        .where(eq(webhookDeliveries.id, candidate.id))
        .returning();
      return claimed === undefined
        ? undefined
        : claimedDelivery(claimed, input);
    });
  }

  async claimDueWebhookDeliveries(input: {
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    limit: number;
    maxAttempts: number;
    now: string;
    orgId: string;
  }): Promise<ClaimedWebhookDeliveryRecord[]> {
    return this.db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.orgId, input.orgId),
            eq(webhookDeliveries.status, "failed"),
            lte(webhookDeliveries.nextAttemptAt, new Date(input.now)),
            lt(webhookDeliveries.attemptCount, input.maxAttempts),
            leaseAvailableAt(input.now),
          ),
        )
        .orderBy(
          asc(webhookDeliveries.nextAttemptAt),
          asc(webhookDeliveries.createdAt),
          asc(webhookDeliveries.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const rows = await transaction
        .update(webhookDeliveries)
        .set({
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
        })
        .where(
          inArray(
            webhookDeliveries.id,
            candidates.map((candidate) => candidate.id),
          ),
        )
        .returning();
      return rows.map((row) => claimedDelivery(row, input));
    });
  }

  async completeWebhookDeliveryAttempt(input: {
    delivery: WebhookDeliveryRecord;
    leaseOwner: string;
    leaseToken: string;
    now: string;
  }): Promise<WebhookDeliveryRecord | undefined> {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({
        ...toWebhookDeliveryUpdate(input.delivery),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(webhookDeliveries.id, input.delivery.id),
          eq(webhookDeliveries.orgId, input.delivery.orgId),
          eq(webhookDeliveries.leaseOwner, input.leaseOwner),
          eq(webhookDeliveries.leaseToken, input.leaseToken),
          gt(webhookDeliveries.leaseExpiresAt, new Date(input.now)),
        ),
      )
      .returning();
    return row === undefined ? undefined : toWebhookDeliveryRecord(row);
  }

  async createWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values(toWebhookDeliveryInsert(delivery))
      .onConflictDoNothing({ target: webhookDeliveries.id })
      .returning();
    if (row !== undefined) return toWebhookDeliveryRecord(row);
    const [existing] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id))
      .limit(1);
    return existing === undefined
      ? delivery
      : toWebhookDeliveryRecord(existing);
  }

  async updateWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set(toWebhookDeliveryUpdate(delivery))
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning();
    return row === undefined ? delivery : toWebhookDeliveryRecord(row);
  }
}

function leaseAvailableAt(now: string) {
  return or(
    isNull(webhookDeliveries.leaseExpiresAt),
    lte(webhookDeliveries.leaseExpiresAt, new Date(now)),
  );
}

function claimedDelivery(
  row: typeof webhookDeliveries.$inferSelect,
  lease: { leaseExpiresAt: string; leaseOwner: string; leaseToken: string },
): ClaimedWebhookDeliveryRecord {
  return {
    delivery: toWebhookDeliveryRecord(row),
    leaseExpiresAt: lease.leaseExpiresAt,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
  };
}

function toWebhookDeliveryUpdate(record: WebhookDeliveryRecord) {
  return {
    attemptCount: record.attemptCount,
    errorCode: record.errorCode ?? null,
    eventType: record.eventType,
    nextAttemptAt: optionalDate(record.nextAttemptAt),
    payload: record.payload,
    responseStatus: record.responseStatus ?? null,
    status: record.status,
    updatedAt: new Date(record.updatedAt),
  };
}

export function toWebhookSubscriptionRecord(
  row: typeof webhookSubscriptions.$inferSelect,
): WebhookSubscriptionRecord {
  const subscription: WebhookSubscriptionRecord = {
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    eventTypes: asWebhookEventTypes(row.eventTypes),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) subscription.disabledAt = disabledAt;
  return subscription;
}

export function toWebhookDeliveryRecord(
  row: Omit<
    typeof webhookDeliveries.$inferSelect,
    "leaseExpiresAt" | "leaseOwner" | "leaseToken"
  > &
    Partial<
      Pick<
        typeof webhookDeliveries.$inferSelect,
        "leaseExpiresAt" | "leaseOwner" | "leaseToken"
      >
    >,
): WebhookDeliveryRecord {
  const delivery: WebhookDeliveryRecord = {
    id: row.id,
    orgId: row.orgId,
    subscriptionId: row.subscriptionId,
    eventType: asWebhookEventType(row.eventType),
    payload: asJsonRecord(row.payload),
    status: row.status,
    attemptCount: row.attemptCount,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.responseStatus !== null) delivery.responseStatus = row.responseStatus;
  const errorCode = optionalIsoString(row.errorCode);
  if (errorCode !== undefined) delivery.errorCode = errorCode;
  const nextAttemptAt = optionalIsoString(row.nextAttemptAt);
  if (nextAttemptAt !== undefined) delivery.nextAttemptAt = nextAttemptAt;
  return delivery;
}

function toWebhookSubscriptionInsert(
  record: WebhookSubscriptionRecord,
): typeof webhookSubscriptions.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    url: record.url,
    eventTypes: record.eventTypes,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    disabledAt: optionalDate(record.disabledAt),
  };
}

function toWebhookDeliveryInsert(
  record: WebhookDeliveryRecord,
): typeof webhookDeliveries.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    subscriptionId: record.subscriptionId,
    eventType: record.eventType,
    payload: record.payload,
    status: record.status,
    attemptCount: record.attemptCount,
    responseStatus: record.responseStatus ?? null,
    errorCode: record.errorCode ?? null,
    nextAttemptAt: optionalDate(record.nextAttemptAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function asWebhookEventTypes(value: unknown): WebhookEventTypeRecord[] {
  return asStringArray(value).filter(
    (eventType): eventType is WebhookEventTypeRecord =>
      eventType === "knowledge.source.indexed" ||
      eventType === "quota.alert" ||
      eventType === "run.cancelled" ||
      eventType === "run.completed" ||
      eventType === "run.failed" ||
      eventType === "tool.call.failed" ||
      eventType === "tool.call.succeeded" ||
      eventType === "webhook.test",
  );
}

function asWebhookEventType(value: string): WebhookEventTypeRecord {
  const [eventType] = asWebhookEventTypes([value]);
  return eventType ?? "webhook.test";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
