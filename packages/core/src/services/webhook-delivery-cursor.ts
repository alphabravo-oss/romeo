import type { WebhookDelivery } from "../domain/webhooks";
import { ApiError } from "../errors";
import {
  createPageCursorCodec,
  derivePageCursorSecret,
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

const deliverySort = [
  { field: "createdAt", direction: "desc" },
  { field: "id", direction: "asc" },
] as const;

export class WebhookDeliveryCursorCodec {
  private readonly codec: PageCursorCodec;

  constructor(signingKey: string) {
    this.codec = createPageCursorCodec({
      resource: "webhook.deliveries",
      secrets: [derivePageCursorSecret(signingKey, "webhook.deliveries")],
      maxAgeSeconds: 3_600,
    });
  }

  encode(input: {
    delivery: Pick<WebhookDelivery, "createdAt" | "id">;
    orgId: string;
    subscriptionId?: string;
  }): string {
    return this.codec.encode({
      filter: {
        orgId: input.orgId,
        subscriptionId: input.subscriptionId ?? null,
      },
      sort: deliverySort,
      position: {
        createdAt: input.delivery.createdAt,
        id: input.delivery.id,
      },
    });
  }

  decode(input: { cursor: string; orgId: string; subscriptionId?: string }): {
    createdAt: string;
    id: string;
  } {
    try {
      return this.codec.decode(
        input.cursor,
        {
          filter: {
            orgId: input.orgId,
            subscriptionId: input.subscriptionId ?? null,
          },
          sort: deliverySort,
        },
        deliveryPosition,
      );
    } catch (caught) {
      if (!(caught instanceof InvalidPageCursorError)) throw caught;
      throw new ApiError(
        "invalid_webhook_delivery_cursor",
        "Webhook delivery cursor is invalid or expired.",
        400,
      );
    }
  }
}

function deliveryPosition(
  value: unknown,
): { createdAt: string; id: string } | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("createdAt" in value) ||
    !("id" in value) ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    value.id.length < 1
  ) {
    return undefined;
  }
  return { createdAt: value.createdAt, id: value.id };
}
