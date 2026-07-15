import type { BackgroundJob } from './admin'

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

export interface WebhookDelivery {
  id: string
  orgId: string
  subscriptionId: string
  eventType: WebhookEventType
  payload: Record<string, unknown>
  status: 'delivered' | 'failed' | 'pending'
  attemptCount: number
  responseStatus?: number
  errorCode?: string
  nextAttemptAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateWebhookSubscriptionInput {
  url: string
  eventTypes: WebhookEventType[]
}

export interface CreatedWebhookSubscription {
  subscription: WebhookSubscription
  signingSecret: string
}

export interface TestWebhookInput {
  subscriptionId: string
  payload?: Record<string, unknown>
}

export interface WebhookRetryResult {
  job: BackgroundJob
  deliveries: WebhookDelivery[]
}
