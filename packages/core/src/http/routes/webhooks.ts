import type { RomeoApi } from '../context'
import { bulkDisableWebhooksSchema, createWebhookSubscriptionSchema, testWebhookSchema } from '../schemas'

export function registerWebhookRoutes(app: RomeoApi): void {
  app.get('/api/v1/webhooks', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').webhooks.list(subject, context.req.query('workspaceId'))
    return context.json({ data })
  })

  app.post('/api/v1/webhooks/bulk-disable', async (context) => {
    const subject = context.get('subject')
    const body = bulkDisableWebhooksSchema.parse(await context.req.json())
    const data = await context.get('services').webhooks.bulkDisable({ subject, webhookIds: body.webhookIds })
    return context.json({ data })
  })

  app.post('/api/v1/webhooks', async (context) => {
    const subject = context.get('subject')
    const body = createWebhookSubscriptionSchema.parse(await context.req.json())
    const data = await context.get('services').webhooks.create({ subject, url: body.url, eventTypes: body.eventTypes })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/webhooks/:webhookId/disable', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').webhooks.disable({ subject, subscriptionId: context.req.param('webhookId') })
    return context.json({ data })
  })

  app.get('/api/v1/webhooks/:webhookId/deliveries', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').webhooks.deliveries(subject, context.req.param('webhookId'))
    return context.json({ data })
  })

  app.post('/api/v1/webhooks/:webhookId/test', async (context) => {
    const subject = context.get('subject')
    const body = testWebhookSchema.parse(await context.req.json().catch(() => ({})))
    const data = await context.get('services').webhooks.sendTest({
      subject,
      subscriptionId: context.req.param('webhookId'),
      ...(body.payload !== undefined ? { payload: body.payload } : {})
    })
    return context.json({ data }, 202)
  })

  app.get('/api/v1/webhook-deliveries', async (context) => {
    const subject = context.get('subject')
    const limit = parseWebhookLimit(context.req.query('limit'))
    const cursor = context.req.query('cursor')
    const subscriptionId = context.req.query('webhookId')
    const page = await context.get('services').webhooks.deliveriesPage(subject, {
      ...(subscriptionId !== undefined ? { subscriptionId } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {})
    })
    return context.json({ data: page.data, nextCursor: page.nextCursor })
  })

  app.post('/api/v1/webhook-deliveries/retry-due', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').webhooks.retryDueDeliveries(subject)
    return context.json({ data }, 202)
  })
}

function parseWebhookLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}
