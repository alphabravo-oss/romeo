import type { RomeoApi } from '../context'
import { createDeviceAuthorizationSchema, refreshDeviceAuthorizationSchema } from '../schemas'

export function registerDeviceAuthorizationRoutes(app: RomeoApi): void {
  app.get('/api/v1/device-authorizations', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').deviceAuthorizations.list(subject)
    return context.json({ data })
  })

  app.post('/api/v1/device-authorizations', async (context) => {
    const subject = context.get('subject')
    const body = createDeviceAuthorizationSchema.parse(await context.req.json())
    const data = await context.get('services').deviceAuthorizations.create({
      subject,
      name: body.name,
      scopes: body.scopes,
      ...(body.ttlDays === undefined ? {} : { ttlDays: body.ttlDays })
    })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/device-authorizations/refresh', async (context) => {
    const body = refreshDeviceAuthorizationSchema.parse(await context.req.json())
    const data = await context.get('services').deviceAuthorizations.refresh(body.refreshToken)
    return context.json({ data })
  })

  app.post('/api/v1/device-authorizations/:deviceAuthorizationId/revoke', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').deviceAuthorizations.revoke({
      subject,
      deviceAuthorizationId: context.req.param('deviceAuthorizationId')
    })
    return context.json({ data })
  })
}

