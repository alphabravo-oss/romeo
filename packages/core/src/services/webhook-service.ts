import { assertScope, AuthorizationError, type AuthSubject } from "@romeo/auth";
import type { BackgroundJob } from "../domain/entities";
import type {
  WebhookDelivery,
  WebhookEventType,
  WebhookSubscription,
} from "../domain/webhooks";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import type { WebsiteConnectorHostLookup } from "./data-connector-network-policy";
import type { DnsPinnedFetch } from "./dns-pinned-fetch";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import {
  auditWebhook,
  auditWebhookBulkDisable,
  maxWebhookAttempts,
  normalizeDeliveryLimit,
  publicWebhookDelivery,
  retryableWebhookPayload,
  stableWebhookDeliveryId,
  validateEventTypes,
} from "./webhook-service-helpers";
import { WebhookDeliveryCursorCodec } from "./webhook-delivery-cursor";
import { WebhookDeliveryEngine } from "./webhook-delivery-engine";
import { deriveWebhookSecret } from "./webhook-signing";
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

export interface WebhookServiceOptions {
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  pinnedFetchImpl?: DnsPinnedFetch;
  signingKey: string;
  timeoutMs?: number;
  retryBatchSize?: number;
  retryConcurrency?: number;
  retryLeaseMs?: number;
}

export class WebhookService {
  private readonly retryWorkerId = createId("webhook_worker");
  private readonly deliveryEngine: WebhookDeliveryEngine;
  private readonly deliveryCursor: WebhookDeliveryCursorCodec;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: WebhookServiceOptions,
  ) {
    this.deliveryEngine = new WebhookDeliveryEngine(
      repository,
      options,
      this.retryWorkerId,
    );
    this.deliveryCursor = new WebhookDeliveryCursorCodec(options.signingKey);
  }

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
    assertScope(subject, "webhooks:read");
    if (options.subscriptionId !== undefined)
      await this.getAuthorizedSubscription(
        this.repository,
        subject,
        options.subscriptionId,
      );
    const limit = normalizeDeliveryLimit(options.limit);
    const deliveries = await this.repository.listWebhookDeliveriesPage({
      orgId: subject.orgId,
      limit: limit + 1,
      ...(options.subscriptionId === undefined
        ? {}
        : { subscriptionId: options.subscriptionId }),
      ...(options.cursor === undefined
        ? {}
        : {
            cursor: this.deliveryCursor.decode({
              orgId: subject.orgId,
              ...(options.subscriptionId === undefined
                ? {}
                : { subscriptionId: options.subscriptionId }),
              cursor: options.cursor,
            }),
          }),
    });
    const hasMore = deliveries.length > limit;
    const slice = deliveries.slice(0, limit).map(publicWebhookDelivery);
    const last = slice[slice.length - 1];
    return {
      data: slice,
      ...(hasMore && last !== undefined
        ? {
            nextCursor: this.deliveryCursor.encode({
              orgId: subject.orgId,
              ...(options.subscriptionId === undefined
                ? {}
                : { subscriptionId: options.subscriptionId }),
              delivery: last,
            }),
          }
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
    return this.deliveryEngine.deliver(subscription, "webhook.test", {
      requestedBy: input.subject.id,
      subscriptionId: subscription.id,
      ...input.payload,
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
      const leaseToken = createId("webhook_lease");
      const claimed = await this.repository.claimDueWebhookDeliveries({
        orgId: subject.orgId,
        leaseOwner: this.retryWorkerId,
        leaseToken,
        now,
        leaseExpiresAt: this.deliveryEngine.leaseExpiresAt(now),
        limit: normalizeRetryBatchSize(this.options.retryBatchSize),
        maxAttempts: maxWebhookAttempts,
      });
      const attempted = await mapWithConcurrency(
        claimed,
        normalizeRetryConcurrency(this.options.retryConcurrency),
        async (lease) => {
          const subscription = await this.repository.getWebhookSubscription(
            lease.delivery.subscriptionId,
          );
          if (!subscription || subscription.disabledAt !== undefined)
            return this.deliveryEngine.completeUnavailableClaim(lease);
          return this.deliveryEngine.attemptDelivery(subscription, lease);
        },
      );
      const deliveries = attempted.map(publicWebhookDelivery);
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
    const payload = retryableWebhookPayload(input.eventType, input.payload);
    return mapWithConcurrency(
      subscriptions,
      normalizeRetryConcurrency(this.options.retryConcurrency),
      (subscription) =>
        this.deliveryEngine.deliver(subscription, input.eventType, payload, {
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

function normalizeRetryBatchSize(value: number | undefined): number {
  if (!Number.isInteger(value)) return 100;
  return Math.max(1, Math.min(1_000, value!));
}

function normalizeRetryConcurrency(value: number | undefined): number {
  if (!Number.isInteger(value)) return 4;
  return Math.max(1, Math.min(32, value!));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = values.length;
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await work(values[index]!);
      }
    }),
  );
  return results;
}
