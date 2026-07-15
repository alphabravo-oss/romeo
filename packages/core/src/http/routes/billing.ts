import type { RomeoApi } from '../context'
import { applyBillingPlanSchema, syncExternalBillingEventSchema } from '../schemas'

export function registerBillingRoutes(app: RomeoApi): void {
  app.get('/api/v1/billing/plan', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').billing.current(subject)
    return context.json({ data: data ?? null })
  })

  app.post('/api/v1/billing/plan', async (context) => {
    const subject = context.get('subject')
    const body = applyBillingPlanSchema.parse(await context.req.json())
    const input: {
      subject: typeof subject
      code: string
      name: string
      status: typeof body.status
      source: typeof body.source
      quotaTemplates: typeof body.quotaTemplates
      metadata: typeof body.metadata
      externalCustomerId?: string
      externalSubscriptionId?: string
      lifecycle?: NonNullable<typeof body.lifecycle>
    } = {
      subject,
      code: body.code,
      name: body.name,
      status: body.status,
      source: body.source,
      quotaTemplates: body.quotaTemplates,
      metadata: body.metadata
    }
    if (body.externalCustomerId !== undefined) input.externalCustomerId = body.externalCustomerId
    if (body.externalSubscriptionId !== undefined) input.externalSubscriptionId = body.externalSubscriptionId
    if (body.lifecycle !== undefined) input.lifecycle = body.lifecycle
    const data = await context.get('services').billing.applyPlan(input)
    return context.json({ data })
  })

  app.post('/api/v1/billing/external-events', async (context) => {
    const subject = context.get('subject')
    const event = syncExternalBillingEventSchema.parse(await context.req.json())
    const data = await context.get('services').billing.syncExternalEvent({ subject, event })
    return context.json({ data })
  })

  app.get('/api/v1/billing/entitlements', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').billing.entitlementReport(subject)
    return context.json({ data })
  })

  app.post('/api/v1/billing/entitlements/reconcile', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').billing.reconcileEntitlements(subject)
    return context.json({ data })
  })

  app.get('/api/v1/billing/lifecycle', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').billing.lifecycleReport(subject)
    return context.json({ data })
  })

  app.post('/api/v1/billing/lifecycle/enforce', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').billing.enforceLifecycle(subject)
    return context.json({ data })
  })

  app.post('/api/v1/billing/webhooks/stripe', async (context) => {
    const data = await context.get('services').billing.syncStripeWebhook({
      payload: await context.req.text(),
      signatureHeader: context.req.header('stripe-signature')
    })
    return context.json({ data })
  })

  app.post('/api/v1/billing/webhooks/generic', async (context) => {
    const data = await context.get('services').billing.syncGenericWebhook({
      payload: await context.req.text(),
      signatureHeader: context.req.header('x-romeo-billing-signature'),
      timestampHeader: context.req.header('x-romeo-billing-timestamp')
    })
    return context.json({ data })
  })
}
