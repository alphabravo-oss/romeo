import type { RomeoApi } from '../context'
import { bulkDisableServiceAccountsSchema, createApiKeySchema, createServiceAccountSchema } from '../schemas'

export function registerServiceAccountRoutes(app: RomeoApi): void {
  app.get('/api/v1/service-accounts', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').serviceAccounts.list(subject)
    return context.json({ data })
  })

  app.post('/api/v1/service-accounts', async (context) => {
    const subject = context.get('subject')
    const body = createServiceAccountSchema.parse(await context.req.json())
    const data = await context.get('services').serviceAccounts.create({ subject, name: body.name, scopes: body.scopes })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/service-accounts/bulk-disable', async (context) => {
    const subject = context.get('subject')
    const body = bulkDisableServiceAccountsSchema.parse(await context.req.json())
    const data = await context.get('services').serviceAccounts.bulkDisable({ subject, serviceAccountIds: body.serviceAccountIds })
    return context.json({ data })
  })

  app.post('/api/v1/service-accounts/:serviceAccountId/api-keys', async (context) => {
    const subject = context.get('subject')
    const body = createApiKeySchema.parse(await context.req.json())
    const data = await context.get('services').serviceAccounts.createApiKey({
      subject,
      serviceAccountId: context.req.param('serviceAccountId'),
      name: body.name,
      scopes: body.scopes
    })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/service-accounts/:serviceAccountId/disable', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').serviceAccounts.disable({
      subject,
      serviceAccountId: context.req.param('serviceAccountId')
    })
    return context.json({ data })
  })
}
