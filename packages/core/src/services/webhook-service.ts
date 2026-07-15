import { assertScope, AuthorizationError, type AuthSubject } from "@romeo/auth";

import type { BackgroundJob } from "../domain/entities";
import type {
  WebhookDelivery,
  WebhookEventType,
  WebhookSubscription,
} from "../domain/webhooks";
import { webhookEventTypes } from "../domain/webhooks";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";
import { normalizeWebhookUrl } from "./webhook-url";

const webhookEventTypeSet = new Set<string>(webhookEventTypes);

export interface CreatedWebhookSubscription {
  subscription: WebhookSubscription;
  signingSecret: string;
}

export interface WebhookEmitter {
  emit(input: {
    orgId: string;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  }): Promise<WebhookDelivery[]>;
}

export interface WebhookRetryResult {
  job: BackgroundJob;
  deliveries: WebhookDelivery[];
}

export const WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT = 50;
export const WEBHOOK_DELIVERY_PAGE_MAX_LIMIT = 1000;

export interface WebhookDeliveryPageOptions {
  subscriptionId?: string;
  limit?: number;
  cursor?: string;
}

export interface WebhookDeliveryPage {
  data: WebhookDelivery[];
  nextCursor?: string;
}

export interface WebhookBulkDisableResult {
  webhookId: string;
  status: "disabled" | "already_disabled" | "not_found";
}

export class WebhookService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: { fetchImpl?: typeof fetch; signingKey: string },
  ) {}

  async list(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<WebhookSubscription[]> {
    assertScope(subject, "webhooks:read");
    if (workspaceId !== undefined)
      this.assertWorkspaceAccess(subject, workspaceId);
    return this.repository.listWebhookSubscriptions(subject.orgId);
  }

  async create(input: {
    subject: AuthSubject;
    url: string;
    eventTypes: WebhookEventType[];
  }): Promise<CreatedWebhookSubscription> {
    assertScope(input.subject, "webhooks:write");
    const eventTypes = validateEventTypes(input.eventTypes);
    const now = new Date().toISOString();
    const created = await this.repository.transaction(async (repository) => {
      const createdBy = await persistedSubjectActorId(
        repository,
        input.subject,
        {
          kind: "service_account_webhook_owner",
          name: "Service Account Webhook Owner",
        },
      );
      const subscription: WebhookSubscription = {
        id: createId("webhook"),
        orgId: input.subject.orgId,
        url: normalizeWebhookUrl(input.url),
        eventTypes,
        createdBy,
        createdAt: now,
        updatedAt: now,
      };
      const createdSubscription =
        await repository.createWebhookSubscription(subscription);
      await this.audit(
        repository,
        input.subject,
        "webhook.create",
        createdSubscription.id,
      );
      return createdSubscription;
    });
    return {
      subscription: created,
      signingSecret: await deriveWebhookSecret(
        this.options.signingKey,
        created.id,
      ),
    };
  }

  async disable(input: {
    subject: AuthSubject;
    subscriptionId: string;
  }): Promise<WebhookSubscription> {
    assertScope(input.subject, "webhooks:write");
    const subscription = await this.getAuthorizedSubscription(
      this.repository,
      input.subject,
      input.subscriptionId,
    );
    if (subscription.disabledAt !== undefined) return subscription;

    return this.repository.transaction(async (repository) => {
      const currentSubscription = await this.getAuthorizedSubscription(
        repository,
        input.subject,
        input.subscriptionId,
      );
      if (currentSubscription.disabledAt !== undefined)
        return currentSubscription;
      const disabledAt = new Date().toISOString();
      const updated = await repository.updateWebhookSubscription({
        ...currentSubscription,
        disabledAt,
        updatedAt: disabledAt,
      });
      await this.audit(
        repository,
        input.subject,
        "webhook.disable",
        currentSubscription.id,
      );
      return updated;
    });
  }

  async deliveries(
    subject: AuthSubject,
    subscriptionId?: string,
  ): Promise<WebhookDelivery[]> {
    assertScope(subject, "webhooks:read");
    if (subscriptionId !== undefined)
      await this.getAuthorizedSubscription(
        this.repository,
        subject,
        subscriptionId,
      );
    const deliveries = await this.repository.listWebhookDeliveries(
      subject.orgId,
      subscriptionId,
    );
    return deliveries.map(publicWebhookDelivery);
  }

  async deliveriesPage(
    subject: AuthSubject,
    options: WebhookDeliveryPageOptions = {},
  ): Promise<WebhookDeliveryPage> {
    const deliveries = await this.deliveries(subject, options.subscriptionId);
    const limit = normalizeDeliveryLimit(options.limit);
    const startIndex =
      options.cursor !== undefined
        ? indexAfterDeliveryCursor(deliveries, options.cursor)
        : 0;
    const slice = deliveries.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < deliveries.length;
    const last = slice[slice.length - 1];
    return {
      data: slice,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeDeliveryCursor(last) }
        : {}),
    };
  }

  async bulkDisable(input: {
    subject: AuthSubject;
    webhookIds: string[];
  }): Promise<WebhookBulkDisableResult[]> {
    assertScope(input.subject, "webhooks:write");
    const results: WebhookBulkDisableResult[] = [];
    for (const webhookId of input.webhookIds) {
      const subscription =
        await this.repository.getWebhookSubscription(webhookId);
      if (!subscription || subscription.orgId !== input.subject.orgId) {
        results.push({ webhookId, status: "not_found" });
        await this.repository.transaction((repository) =>
          this.auditBulkDisable(
            repository,
            input.subject,
            webhookId,
            "failure",
          ),
        );
        continue;
      }
      if (subscription.disabledAt !== undefined) {
        results.push({ webhookId, status: "already_disabled" });
        continue;
      }
      await this.repository.transaction(async (repository) => {
        const currentSubscription =
          await repository.getWebhookSubscription(webhookId);
        if (
          !currentSubscription ||
          currentSubscription.orgId !== input.subject.orgId
        ) {
          await this.auditBulkDisable(
            repository,
            input.subject,
            webhookId,
            "failure",
          );
          return;
        }
        if (currentSubscription.disabledAt !== undefined) return;
        const disabledAt = new Date().toISOString();
        await repository.updateWebhookSubscription({
          ...currentSubscription,
          disabledAt,
          updatedAt: disabledAt,
        });
        await this.auditBulkDisable(
          repository,
          input.subject,
          webhookId,
          "success",
        );
      });
      results.push({ webhookId, status: "disabled" });
    }
    return results;
  }

  async sendTest(input: {
    subject: AuthSubject;
    subscriptionId: string;
    payload?: Record<string, unknown>;
  }): Promise<WebhookDelivery> {
    assertScope(input.subject, "webhooks:write");
    const subscription = await this.getAuthorizedSubscription(
      this.repository,
      input.subject,
      input.subscriptionId,
    );
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "worker.enqueue",
      workerClass: "webhook.delivery",
    });
    return this.deliver(subscription, "webhook.test", {
      requestedBy: input.subject.id,
      subscriptionId: subscription.id,
      ...(input.payload ?? {}),
    });
  }

  async retryDueDeliveries(subject: AuthSubject): Promise<WebhookRetryResult> {
    assertScope(subject, "admin:write");
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "worker.enqueue",
      workerClass: "webhook.delivery",
    });
    const job = await startBackgroundJob(this.repository, {
      orgId: subject.orgId,
      type: "webhook.retry_due",
      payload: { requestedBy: subject.id },
    });

    try {
      const now = new Date().toISOString();
      const dueDeliveries = (
        await this.repository.listWebhookDeliveries(subject.orgId)
      ).filter(
        (delivery) =>
          delivery.status === "failed" &&
          delivery.nextAttemptAt !== undefined &&
          delivery.nextAttemptAt <= now &&
          delivery.attemptCount < maxWebhookAttempts,
      );
      const deliveries: WebhookDelivery[] = [];
      for (const delivery of dueDeliveries) {
        const subscription = await this.repository.getWebhookSubscription(
          delivery.subscriptionId,
        );
        if (!subscription || subscription.disabledAt !== undefined) continue;
        deliveries.push(
          publicWebhookDelivery(
            await this.attemptDelivery(subscription, delivery),
          ),
        );
      }
      return {
        job: await completeBackgroundJob(this.repository, job),
        deliveries,
      };
    } catch (error) {
      await failBackgroundJob(this.repository, job, "webhook_retry_failed");
      throw error;
    }
  }

  async emit(input: {
    orgId: string;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  }): Promise<WebhookDelivery[]> {
    const subscriptions = (
      await this.repository.listWebhookSubscriptions(input.orgId)
    ).filter(
      (subscription) =>
        subscription.disabledAt === undefined &&
        subscription.eventTypes.includes(input.eventType),
    );
    const deliveries: WebhookDelivery[] = [];
    const payload = retryableWebhookPayload(input.eventType, input.payload);
    for (const subscription of subscriptions)
      deliveries.push(
        await this.deliver(subscription, input.eventType, payload, {
          storedPayload: payload,
        }),
      );
    return deliveries;
  }

  private async deliver(
    subscription: WebhookSubscription,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    options: { storedPayload?: Record<string, unknown> } = {},
  ): Promise<WebhookDelivery> {
    if (subscription.disabledAt !== undefined)
      throw new ApiError(
        "webhook_disabled",
        "Webhook subscription is disabled.",
        409,
      );

    const now = new Date().toISOString();
    const storedPayload =
      options.storedPayload ?? summarizeWebhookPayload(payload);
    const delivery = await this.repository.createWebhookDelivery({
      id: createId("webhook_delivery"),
      orgId: subscription.orgId,
      subscriptionId: subscription.id,
      eventType,
      payload: storedPayload,
      status: "pending",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return publicWebhookDelivery(
      await this.attemptDelivery(subscription, delivery, payload),
    );
  }

  private async attemptDelivery(
    subscription: WebhookSubscription,
    delivery: WebhookDelivery,
    payload: Record<string, unknown> = delivery.payload,
  ): Promise<WebhookDelivery> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      createdAt: delivery.createdAt,
      data: payload,
    });
    const secret = await deriveWebhookSecret(
      this.options.signingKey,
      subscription.id,
    );
    const signature = await signWebhookPayload(secret, timestamp, body);

    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        subscription.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Romeo-Webhooks/0.1",
            "x-romeo-delivery": delivery.id,
            "x-romeo-event": delivery.eventType,
            "x-romeo-signature": signature,
            "x-romeo-timestamp": timestamp,
          },
          body,
        },
      );
      return this.repository.updateWebhookDelivery({
        ...delivery,
        status: response.ok ? "delivered" : "failed",
        attemptCount: delivery.attemptCount + 1,
        responseStatus: response.status,
        ...(response.ok
          ? {}
          : {
              errorCode: "http_error",
              nextAttemptAt: nextRetryAt(delivery.attemptCount + 1),
            }),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      return this.repository.updateWebhookDelivery({
        ...delivery,
        status: "failed",
        attemptCount: delivery.attemptCount + 1,
        errorCode: "network_error",
        nextAttemptAt: nextRetryAt(delivery.attemptCount + 1),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async getAuthorizedSubscription(
    repository: RomeoRepository,
    subject: AuthSubject,
    subscriptionId: string,
  ): Promise<WebhookSubscription> {
    const subscription =
      await repository.getWebhookSubscription(subscriptionId);
    if (!subscription || subscription.orgId !== subject.orgId)
      throw notFound("Webhook subscription");
    return subscription;
  }

  private assertWorkspaceAccess(
    subject: AuthSubject,
    workspaceId: string,
  ): void {
    if (
      subject.isAdmin !== true &&
      !subject.workspaceIds.includes(workspaceId)
    ) {
      throw new AuthorizationError(
        "The workspace is outside the caller workspace access.",
      );
    }
  }

  private async auditBulkDisable(
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

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
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
}

function validateEventTypes(
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

function nextRetryAt(attemptCount: number): string {
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function summarizeWebhookPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    redacted: true,
    keyCount: Object.keys(payload).length,
    keys: Object.keys(payload).sort(),
  };
}

function publicWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
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

function retryableWebhookPayload(
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (eventType === "run.completed" || eventType === "run.failed") {
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

const maxWebhookAttempts = 5;

function normalizeDeliveryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit))
    return WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT;
  const truncated = Math.floor(limit);
  if (truncated < 1) return 1;
  if (truncated > WEBHOOK_DELIVERY_PAGE_MAX_LIMIT)
    return WEBHOOK_DELIVERY_PAGE_MAX_LIMIT;
  return truncated;
}

// Cursor is an opaque token identifying the last row of the previous page.
// Deliveries come back newest-first; we page by (createdAt, id) so rows sharing
// a createdAt still paginate deterministically.
function encodeDeliveryCursor(delivery: WebhookDelivery): string {
  return Buffer.from(`${delivery.createdAt}|${delivery.id}`, "utf8").toString(
    "base64url",
  );
}

function indexAfterDeliveryCursor(
  deliveries: WebhookDelivery[],
  cursor: string,
): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return deliveries.length;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator === -1) return deliveries.length;
  const id = decoded.slice(separator + 1);
  const position = deliveries.findIndex((delivery) => delivery.id === id);
  return position === -1 ? deliveries.length : position + 1;
}
