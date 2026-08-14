import type { WebhookEventType } from "../domain/webhooks";
import type { WebhookEmitter } from "./webhook-service";
import { reportBackgroundFailure } from "./worker-supervisor";

export function emitWebhookEvent(
  webhooks: WebhookEmitter | undefined,
  input: {
    orgId: string;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  },
): void {
  if (webhooks === undefined) return;
  void webhooks
    .emit(input)
    .catch((error: unknown) =>
      reportBackgroundFailure("webhook_emission", error),
    );
}
