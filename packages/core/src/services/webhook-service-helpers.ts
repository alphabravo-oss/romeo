import type { AuthSubject } from "@romeo/auth";
import { createHash } from "node:crypto";

import type { WebhookDelivery, WebhookEventType } from "../domain/webhooks";
import { webhookEventTypes } from "../domain/webhooks";
import { ApiError } from "../errors";
import type { RomeoRepository } from "../domain/repository";
import { type AuditAction, writeAuditLog } from "./audit-log";

const webhookEventTypeSet = new Set<string>(webhookEventTypes);

export const WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT = 50;
export const WEBHOOK_DELIVERY_PAGE_MAX_LIMIT = 1000;

export async function auditWebhook<A extends AuditAction>(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: A,
  webhookId: string,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType: "webhook",
    resourceId: webhookId,
    metadata: {},
  });
}

export async function auditWebhookBulkDisable(
  repository: RomeoRepository,
  subject: AuthSubject,
  webhookId: string,
  outcome: "success" | "failure",
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action: "webhook.bulk_disable",
    resourceType: "webhook",
    resourceId: webhookId,
    outcome,
    metadata: {},
  });
}

export function validateEventTypes(
  eventTypes: WebhookEventType[],
): WebhookEventType[] {
  const unique = [...new Set(eventTypes)];
  if (unique.length === 0)
    throw new ApiError(
      "invalid_webhook_events",
      "At least one webhook event type is required.",
      400,
    );
  const invalid = unique.filter(
    (eventType) => !webhookEventTypeSet.has(eventType),
  );
  if (invalid.length > 0)
    throw new ApiError(
      "invalid_webhook_events",
      "Webhook event type is not supported.",
      400,
      { eventTypes: invalid },
    );
  return unique;
}

export function nextRetryAt(attemptCount: number): string {
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export function summarizeWebhookPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    redacted: true,
    keyCount: Object.keys(payload).length,
    keys: Object.keys(payload).sort(),
  };
}

export function publicWebhookDelivery(
  delivery: WebhookDelivery,
): WebhookDelivery {
  return {
    ...delivery,
    payload: publicWebhookPayload(delivery.payload),
  };
}

function publicWebhookPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (isWebhookPayloadSummary(payload)) return payload;
  return summarizeWebhookPayload(payload);
}

function isWebhookPayloadSummary(payload: Record<string, unknown>): boolean {
  return (
    payload.redacted === true &&
    typeof payload.keyCount === "number" &&
    Array.isArray(payload.keys) &&
    payload.keys.every((key) => typeof key === "string")
  );
}

export function retryableWebhookPayload(
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (
    eventType === "run.cancelled" ||
    eventType === "run.completed" ||
    eventType === "run.failed"
  ) {
    return cleanPayload(payload, [
      "runId",
      "chatId",
      "workspaceId",
      "agentId",
      "agentVersionId",
      "modelId",
      "providerId",
      "status",
      "completedAt",
    ]);
  }
  if (eventType === "tool.call.succeeded" || eventType === "tool.call.failed") {
    return cleanPayload(payload, [
      "toolCallId",
      "workspaceId",
      "agentId",
      "actorId",
      "toolId",
      "runId",
      "status",
      "riskLevel",
      "approvalRequired",
      "inputKeys",
      "outputKeys",
      "errorCode",
      "completedAt",
    ]);
  }
  if (eventType === "knowledge.source.indexed") {
    return cleanPayload(payload, [
      "sourceId",
      "knowledgeBaseId",
      "workspaceId",
      "actorId",
      "fileName",
      "mimeType",
      "sizeBytes",
      "status",
      "chunkCount",
      "indexedAt",
    ]);
  }
  if (eventType === "quota.alert") {
    return cleanPayload(payload, [
      "quotaBucketId",
      "actorId",
      "scopeType",
      "scopeId",
      "metric",
      "used",
      "limit",
      "percentUsed",
      "severity",
      "resetAt",
    ]);
  }
  return summarizeWebhookPayload(payload);
}

function cleanPayload(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "boolean") {
      clean[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
      continue;
    }
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      clean[key] = [...value];
    }
  }
  return clean;
}

export const maxWebhookAttempts = 5;

export function stableWebhookDeliveryId(
  idempotencyKey: string,
  subscriptionId: string,
): string {
  const digest = createHash("sha256")
    .update(idempotencyKey)
    .update("\0")
    .update(subscriptionId)
    .digest("hex")
    .slice(0, 32);
  return `webhook_delivery_${digest}`;
}

export function normalizeDeliveryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit))
    return WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT;
  const truncated = Math.floor(limit);
  if (truncated < 1) return 1;
  if (truncated > WEBHOOK_DELIVERY_PAGE_MAX_LIMIT)
    return WEBHOOK_DELIVERY_PAGE_MAX_LIMIT;
  return truncated;
}
