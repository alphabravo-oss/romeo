import type { WebhookEventType } from '../domain/webhooks'
import type { WebhookEmitter } from './webhook-service'

export function emitWebhookEvent(
  webhooks: WebhookEmitter | undefined,
  input: { orgId: string; eventType: WebhookEventType; payload: Record<string, unknown> }
): void {
  if (webhooks === undefined) return
  void webhooks.emit(input).catch(() => undefined)
}
