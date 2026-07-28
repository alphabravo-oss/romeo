import { assertScope, AuthorizationError, type AuthSubject } from "@romeo/auth";
import type { BackgroundJob } from "../domain/entities";
import type {
  WebhookDelivery,
  WebhookEventType,
  WebhookSubscription,
} from "../domain/webhooks";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import {
  auditWebhook,
  auditWebhookBulkDisable,
  encodeDeliveryCursor,
  indexAfterDeliveryCursor,
  maxWebhookAttempts,
  nextRetryAt,
  normalizeDeliveryLimit,
  publicWebhookDelivery,
  retryableWebhookPayload,
  stableWebhookDeliveryId,
  summarizeWebhookPayload,
  validateEventTypes,
  WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT,
  WEBHOOK_DELIVERY_PAGE_MAX_LIMIT,
} from "./webhook-service-helpers";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";
import { normalizeWebhookUrl } from "./webhook-url";

export interface CreatedWebhookSubscription {
  subscription: WebhookSubscription;
  signingSecret: string;
}

export interface WebhookEmitter {
  emit(input: {
    orgId: string;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<WebhookDelivery[]>;
}

export interface WebhookRetryResult {
  job: BackgroundJob;
  deliveries: WebhookDelivery[];
}

export {
  WEBHOOK_DELIVERY_PAGE_DEFAULT_LIMIT,
  WEBHOOK_DELIVERY_PAGE_MAX_LIMIT,
} from "./webhook-service-helpers";

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
      await auditWebhook(
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
      await auditWebhook(
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
          auditWebhookBulkDisable(
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
          await auditWebhookBulkDisable(
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
        await auditWebhookBulkDisable(
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
    idempotencyKey?: string;
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
          ...(input.idempotencyKey === undefined
            ? {}
            : {
                deliveryId: stableWebhookDeliveryId(
                  input.idempotencyKey,
                  subscription.id,
                ),
              }),
        }),
      );
    return deliveries;
  }

  private async deliver(
    subscription: WebhookSubscription,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    options: {
      deliveryId?: string;
      storedPayload?: Record<string, unknown>;
    } = {},
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
      id: options.deliveryId ?? createId("webhook_delivery"),
      orgId: subscription.orgId,
      subscriptionId: subscription.id,
      eventType,
      payload: storedPayload,
      status: "pending",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (delivery.status !== "pending") return publicWebhookDelivery(delivery);
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
}
