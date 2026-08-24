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
  signatureKeyVersion?: string;
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

export function toWebhookDeliveryUpdate(record: WebhookDeliveryRecord) {
  return {
    attemptCount: record.attemptCount,
    errorCode: record.errorCode ?? null,
    eventType: record.eventType,
    nextAttemptAt: optionalDate(record.nextAttemptAt),
    payload: record.payload,
    responseStatus: record.responseStatus ?? null,
    signatureKeyVersion: record.signatureKeyVersion ?? null,
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
    "leaseExpiresAt" | "leaseOwner" | "leaseToken" | "signatureKeyVersion"
  > &
    Partial<
      Pick<
        typeof webhookDeliveries.$inferSelect,
        "leaseExpiresAt" | "leaseOwner" | "leaseToken" | "signatureKeyVersion"
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
  if (typeof row.signatureKeyVersion === "string")
    delivery.signatureKeyVersion = row.signatureKeyVersion;
  const errorCode = optionalIsoString(row.errorCode);
  if (errorCode !== undefined) delivery.errorCode = errorCode;
  const nextAttemptAt = optionalIsoString(row.nextAttemptAt);
  if (nextAttemptAt !== undefined) delivery.nextAttemptAt = nextAttemptAt;
  return delivery;
}

export function toWebhookSubscriptionInsert(
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

export function toWebhookDeliveryInsert(
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
    signatureKeyVersion: record.signatureKeyVersion ?? null,
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
