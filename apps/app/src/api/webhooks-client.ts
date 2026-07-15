import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  CreateWebhookInput,
  WebhookBulkDisableResult,
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookSubscription
} from './webhooks-types'

export async function listWebhooks(workspaceId?: string): Promise<WebhookSubscription[]> {
  const query = workspaceId !== undefined ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiJson<Envelope<WebhookSubscription[]>>(`/api/v1/webhooks${query}`)
  return response.data
}

export async function bulkDisableWebhooks(webhookIds: string[]): Promise<WebhookBulkDisableResult[]> {
  const response = await apiJson<Envelope<WebhookBulkDisableResult[]>>('/api/v1/webhooks/bulk-disable', {
    method: 'POST',
    body: JSON.stringify({ webhookIds })
  })
  return response.data
}

export async function createWebhook(input: CreateWebhookInput): Promise<WebhookSubscription> {
  const response = await apiJson<Envelope<WebhookSubscription>>('/api/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url: input.url, eventTypes: input.eventTypes })
  })
  return response.data
}

export async function disableWebhook(webhookId: string): Promise<WebhookSubscription> {
  const response = await apiJson<Envelope<WebhookSubscription>>(`/api/v1/webhooks/${encodeURIComponent(webhookId)}/disable`, {
    method: 'POST'
  })
  return response.data
}

export async function testWebhook(webhookId: string): Promise<WebhookDelivery> {
  const response = await apiJson<Envelope<WebhookDelivery>>(`/api/v1/webhooks/${encodeURIComponent(webhookId)}/test`, {
    method: 'POST'
  })
  return response.data
}

export async function listWebhookDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
  const response = await apiJson<Envelope<WebhookDelivery[]>>(`/api/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`)
  return response.data
}

export async function listWebhookDeliveriesPage(
  options: { webhookId?: string; limit?: number; cursor?: string } = {}
): Promise<WebhookDeliveryPage> {
  const params = new URLSearchParams()
  if (options.webhookId !== undefined) params.set('webhookId', options.webhookId)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.cursor !== undefined) params.set('cursor', options.cursor)
  const query = params.toString()
  const response = await apiJson<Envelope<WebhookDelivery[]> & { nextCursor?: string }>(
    `/api/v1/webhook-deliveries${query ? `?${query}` : ''}`
  )
  return {
    data: response.data,
    ...(response.nextCursor !== undefined ? { nextCursor: response.nextCursor } : {})
  }
}
