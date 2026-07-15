export const webhookEventTypes = [
  'webhook.test',
  'run.completed',
  'run.failed',
  'tool.call.succeeded',
  'tool.call.failed',
  'knowledge.source.indexed',
  'quota.alert'
] as const

export type WebhookEventType = (typeof webhookEventTypes)[number]

export interface WebhookSubscription {
  id: string
  orgId: string
  url: string
  eventTypes: WebhookEventType[]
  disabledAt?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'pending'

export interface WebhookDelivery {
  id: string
  orgId: string
  subscriptionId: string
  eventType: WebhookEventType
  payload: Record<string, unknown>
  status: WebhookDeliveryStatus
  attemptCount: number
  responseStatus?: number
  errorCode?: string
  nextAttemptAt?: string
  createdAt: string
  updatedAt: string
}
