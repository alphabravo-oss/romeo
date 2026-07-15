import { and, asc, desc, eq } from "drizzle-orm";

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

  async createWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values(toWebhookDeliveryInsert(delivery))
      .returning();
    return row === undefined ? delivery : toWebhookDeliveryRecord(row);
  }

  async updateWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({
        attemptCount: delivery.attemptCount,
        errorCode: delivery.errorCode ?? null,
        eventType: delivery.eventType,
        nextAttemptAt: optionalDate(delivery.nextAttemptAt),
        payload: delivery.payload,
        responseStatus: delivery.responseStatus ?? null,
        status: delivery.status,
        updatedAt: new Date(delivery.updatedAt),
      })
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning();
    return row === undefined ? delivery : toWebhookDeliveryRecord(row);
  }
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
  row: typeof webhookDeliveries.$inferSelect,
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
