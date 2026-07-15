import type { RomeoApi } from '../context'
import { bulkRevokeApiKeysSchema, createApiKeySchema } from '../schemas'

export function registerApiKeyRoutes(app: RomeoApi): void {
  app.get('/api/v1/api-keys', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').apiKeys.list(subject)
    return context.json({ data })
  })

  app.post('/api/v1/api-keys', async (context) => {
    const subject = context.get('subject')
    const body = createApiKeySchema.parse(await context.req.json())
    const data = await context.get('services').apiKeys.create({ subject, name: body.name, scopes: body.scopes })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/api-keys/bulk-revoke', async (context) => {
    const subject = context.get('subject')
    const body = bulkRevokeApiKeysSchema.parse(await context.req.json())
    const data = await context.get('services').apiKeys.bulkRevoke({ subject, apiKeyIds: body.apiKeyIds })
    return context.json({ data })
  })

  app.post('/api/v1/api-keys/:apiKeyId/revoke', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').apiKeys.revoke({ subject, apiKeyId: context.req.param('apiKeyId') })
    return context.json({ data })
  })
}
