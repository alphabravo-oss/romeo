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
import {
  assertConnectorHostAllowed,
  isRedirectResponse,
  type WebsiteConnectorHostLookup,
} from "./data-connector-network-policy";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import {
  nextRetryAt,
  publicWebhookDelivery,
  summarizeWebhookPayload,
} from "./webhook-service-helpers";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";

export interface WebhookDeliveryEngineOptions {
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  pinnedFetchImpl?: DnsPinnedFetch;
  signingKey: string;
  timeoutMs?: number;
  retryLeaseMs?: number;
}

export class WebhookDeliveryEngine {
  private readonly fetchImpl: typeof fetch;
  private readonly pinnedFetchImpl: DnsPinnedFetch | undefined;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: WebhookDeliveryEngineOptions,
    private readonly retryWorkerId: string,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pinnedFetchImpl =
      options.pinnedFetchImpl ??
      (options.fetchImpl === undefined ? dnsPinnedFetch : undefined);
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
    const secret = await deriveWebhookSecret(
      this.options.signingKey,
      subscription.id,
    );
    const signature = await signWebhookPayload(secret, timestamp, body);

    try {
      const response = await this.fetchWebhook(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": romeoUserAgent("Webhooks"),
          "x-romeo-delivery": delivery.id,
          "x-romeo-event": delivery.eventType,
          "x-romeo-signature": signature,
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
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("webhook_delivery_timeout"),
      this.options.timeoutMs ?? 10_000,
    );
    timeout.unref?.();
    let currentUrl = new URL(target);
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        const approvedAddresses = await assertConnectorHostAllowed(
          currentUrl,
          this.options.hostLookup === undefined
            ? {}
            : { hostLookup: this.options.hostLookup },
        );
        const requestInit: RequestInit = {
          ...init,
          redirect: "manual",
          signal: controller.signal,
        };
        const response =
          this.pinnedFetchImpl === undefined || approvedAddresses.length === 0
            ? await this.fetchImpl(currentUrl.toString(), requestInit)
            : await this.pinnedFetchImpl(
                currentUrl,
                requestInit,
                approvedAddresses,
              );
        if (!isRedirectResponse(response)) {
          const result = { ok: response.ok, status: response.status };
          await cancelResponseBody(response);
          return result;
        }

        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (location === null) return { ok: false, status: response.status };
        if (redirectCount >= 5)
          throw new ApiError(
            "webhook_redirect_limit_exceeded",
            "Webhook delivery exceeded the redirect limit.",
            502,
          );
        const redirected = new URL(location, currentUrl);
        if (redirected.protocol !== "https:")
          throw new ApiError(
            "invalid_webhook_url",
            "Webhook redirects must use HTTPS.",
            400,
          );
        currentUrl = redirected;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Delivery status is already known; body disposal is best-effort cleanup.
  }
}
