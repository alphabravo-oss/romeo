import { pathId } from '../path'
import type { RomeoTransport } from '../transport'
import type {
  CreatedWebhookSubscription,
  CreateWebhookSubscriptionInput,
  TestWebhookInput,
  WebhookDelivery,
  WebhookRetryResult,
  WebhookSubscription
} from '../types'

export function createWebhookResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<WebhookSubscription[]>('GET', '/api/v1/webhooks'),
    create: (input: CreateWebhookSubscriptionInput) => transport.data<CreatedWebhookSubscription>('POST', '/api/v1/webhooks', input),
    disable: (subscriptionId: string) => transport.data<WebhookSubscription>('POST', `/api/v1/webhooks/${pathId(subscriptionId)}/disable`),
    deliveries: (subscriptionId?: string) =>
      subscriptionId === undefined
        ? transport.data<WebhookDelivery[]>('GET', '/api/v1/webhook-deliveries')
        : transport.data<WebhookDelivery[]>('GET', `/api/v1/webhooks/${pathId(subscriptionId)}/deliveries`),
    retryDue: () => transport.data<WebhookRetryResult>('POST', '/api/v1/webhook-deliveries/retry-due'),
    test: (input: TestWebhookInput) => {
      const { subscriptionId, ...body } = input
      return transport.data<WebhookDelivery>('POST', `/api/v1/webhooks/${pathId(subscriptionId)}/test`, body)
    }
  }
}
