import { arrayEnvelope, created, errorResponse, jsonContent, success } from './helpers'

export const webhookPaths = {
  '/webhooks': {
    get: {
      summary: 'List webhook subscriptions',
      parameters: [{ name: 'workspaceId', in: 'query', required: false, schema: { type: 'string' } }],
      responses: { 200: arrayEnvelope('Webhook subscription'), 403: errorResponse }
    },
    post: {
      summary: 'Create a webhook subscription',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/CreateWebhookSubscriptionRequest' }) },
      responses: { 201: created('Webhook subscription with one-time signing secret'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/webhooks/bulk-disable': {
    post: {
      summary: 'Disable multiple webhook subscriptions',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/BulkDisableWebhooksRequest' }) },
      responses: { 200: arrayEnvelope('Webhook bulk-disable result'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/webhooks/{webhookId}/disable': {
    post: {
      summary: 'Disable a webhook subscription',
      parameters: [{ $ref: '#/components/parameters/WebhookId' }],
      responses: { 200: success('Webhook subscription'), 403: errorResponse, 404: errorResponse }
    }
  },
  '/webhooks/{webhookId}/deliveries': {
    get: {
      summary: 'List webhook delivery logs for a subscription',
      parameters: [{ $ref: '#/components/parameters/WebhookId' }],
      responses: { 200: arrayEnvelope('Webhook delivery'), 403: errorResponse, 404: errorResponse }
    }
  },
  '/webhooks/{webhookId}/test': {
    post: {
      summary: 'Send a signed webhook test delivery',
      parameters: [{ $ref: '#/components/parameters/WebhookId' }],
      requestBody: { required: false, content: jsonContent({ $ref: '#/components/schemas/TestWebhookRequest' }) },
      responses: { 202: created('Webhook delivery'), 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse }
    }
  },
  '/webhook-deliveries': {
    get: {
      summary: 'List recent webhook delivery logs',
      parameters: [
        { name: 'webhookId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 1000, default: 50 } },
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } }
      ],
      responses: { 200: arrayEnvelope('Webhook delivery'), 403: errorResponse }
    }
  },
  '/webhook-deliveries/retry-due': {
    post: {
      summary: 'Retry due failed webhook deliveries',
      responses: { 202: created('Webhook retry job result'), 403: errorResponse }
    }
  }
}
