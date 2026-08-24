import { romeoUserAgent } from "@romeo/contracts";
import type {
  WebhookDelivery,
  WebhookEventType,
  WebhookSubscription,
} from "../domain/webhooks";
import type {
  ClaimedWebhookDelivery,
  RomeoRepository,
} from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type { WebsiteConnectorHostLookup } from "./data-connector-network-policy";
import type { DnsPinnedFetch } from "./dns-pinned-fetch";
import { hardenedWebhookFetch } from "./hardened-webhook-fetch";
import {
  nextRetryAt,
  publicWebhookDelivery,
  summarizeWebhookPayload,
} from "./webhook-service-helpers";
import { WebhookSigningKeyring } from "./webhook-signing-keyring";

export interface WebhookDeliveryEngineOptions {
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  pinnedFetchImpl?: DnsPinnedFetch;
  signingKey: string;
  signingKeyPrevious?: string;
  timeoutMs?: number;
  retryLeaseMs?: number;
}

export class WebhookDeliveryEngine {
  private readonly signingKeyring: WebhookSigningKeyring;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: WebhookDeliveryEngineOptions,
    private readonly retryWorkerId: string,
  ) {
    this.signingKeyring = new WebhookSigningKeyring({
      active: options.signingKey,
      previous: options.signingKeyPrevious,
    });
  }

  async deliver(
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
    const claimed = await this.repository.claimWebhookDelivery({
      deliveryId: delivery.id,
      orgId: delivery.orgId,
      leaseOwner: this.retryWorkerId,
      leaseToken: createId("webhook_lease"),
      now,
      leaseExpiresAt: this.leaseExpiresAt(now),
    });
    if (claimed === undefined) return publicWebhookDelivery(delivery);
    return publicWebhookDelivery(
      await this.attemptDelivery(subscription, claimed, payload),
    );
  }

  async attemptDelivery(
    subscription: WebhookSubscription,
    claimed: ClaimedWebhookDelivery,
    payload: Record<string, unknown> = claimed.delivery.payload,
  ): Promise<WebhookDelivery> {
    const delivery = claimed.delivery;
    const attempt = { ...delivery };
    delete attempt.errorCode;
    delete attempt.nextAttemptAt;
    delete attempt.responseStatus;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      createdAt: delivery.createdAt,
      data: payload,
    });
    const signatures = await this.signingKeyring.sign(
      subscription.id,
      timestamp,
      body,
    );
    attempt.signatureKeyVersion = signatures.active.version;

    try {
      const response = await this.fetchWebhook(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": romeoUserAgent("Webhooks"),
          "x-romeo-delivery": delivery.id,
          "x-romeo-event": delivery.eventType,
          "x-romeo-signature": signatures.active.signature,
          "x-romeo-signature-version": signatures.active.version,
          ...(signatures.previous === undefined
            ? {}
            : {
                "x-romeo-signature-previous": signatures.previous.signature,
                "x-romeo-signature-previous-version":
                  signatures.previous.version,
              }),
          "x-romeo-timestamp": timestamp,
        },
        body,
      });
      return this.completeClaim(claimed, {
        ...attempt,
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
      return this.completeClaim(claimed, {
        ...attempt,
        status: "failed",
        attemptCount: delivery.attemptCount + 1,
        errorCode: "network_error",
        nextAttemptAt: nextRetryAt(delivery.attemptCount + 1),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  completeUnavailableClaim(
    claimed: ClaimedWebhookDelivery,
  ): Promise<WebhookDelivery> {
    const delivery = { ...claimed.delivery };
    delete delivery.nextAttemptAt;
    return this.completeClaim(claimed, {
      ...delivery,
      status: "failed",
      errorCode: "webhook_unavailable",
      updatedAt: new Date().toISOString(),
    });
  }

  leaseExpiresAt(now: string): string {
    const minimumMs = (this.options.timeoutMs ?? 10_000) + 5_000;
    const leaseMs = Math.max(minimumMs, this.options.retryLeaseMs ?? 30_000);
    return new Date(Date.parse(now) + leaseMs).toISOString();
  }

  private async completeClaim(
    claimed: ClaimedWebhookDelivery,
    delivery: WebhookDelivery,
  ): Promise<WebhookDelivery> {
    return (
      (await this.repository.completeWebhookDeliveryAttempt({
        delivery,
        leaseOwner: claimed.leaseOwner,
        leaseToken: claimed.leaseToken,
        now: new Date().toISOString(),
      })) ?? claimed.delivery
    );
  }

  private async fetchWebhook(
    target: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number }> {
    const response = await hardenedWebhookFetch(target, init, {
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
      ...(this.options.hostLookup === undefined
        ? {}
        : { hostLookup: this.options.hostLookup }),
      ...(this.options.pinnedFetchImpl === undefined
        ? {}
        : { pinnedFetchImpl: this.options.pinnedFetchImpl }),
      ...(this.options.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.options.timeoutMs }),
    });
    return { ok: response.ok, status: response.status };
  }
}
