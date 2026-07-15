import type { RomeoApi } from '../context'
import { createDataConnectorSchema, syncDataConnectorSchema } from '../schemas'

export function registerDataConnectorRoutes(app: RomeoApi): void {
  app.get('/api/v1/admin/data-connectors/posture', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').dataConnectors.posture(subject)
    return context.json({ data })
  })

  app.get('/api/v1/data-connectors', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').dataConnectors.list(subject, context.req.query('workspaceId'))
    return context.json({ data })
  })

  app.get('/api/v1/data-connectors/catalog', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').dataConnectors.catalog(subject)
    return context.json({ data })
  })

  app.post('/api/v1/data-connectors', async (context) => {
    const subject = context.get('subject')
    const body = createDataConnectorSchema.parse(await context.req.json())
    const data = await context.get('services').dataConnectors.create({
      subject,
      workspaceId: body.workspaceId,
      knowledgeBaseId: body.knowledgeBaseId,
      type: body.type,
      name: body.name,
      config: body.config,
      ...(body.syncIntervalMinutes === undefined ? {} : { syncIntervalMinutes: body.syncIntervalMinutes })
    })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/data-connectors/:connectorId/sync', async (context) => {
    const subject = context.get('subject')
    const body = syncDataConnectorSchema.parse(await context.req.json())
    const data = await context.get('services').dataConnectors.sync({
      subject,
      connectorId: context.req.param('connectorId'),
      ...(body.items !== undefined ? { items: body.items } : {})
    })
    return context.json({ data }, 202)
  })

  app.get('/api/v1/data-connectors/:connectorId/syncs', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').dataConnectors.syncs(subject, context.req.param('connectorId'))
    return context.json({ data })
  })
}
