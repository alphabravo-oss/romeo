import { createSseStream } from '@romeo/ai-runtime'

import type { RomeoApi } from '../context'
import { startRunSchema } from '../schemas'

export function registerRunRoutes(app: RomeoApi): void {
  app.post('/api/v1/runs', async (context) => {
    const subject = context.get('subject')
    const body = startRunSchema.parse(await context.req.json())
    const data = await context.get('services').runs.start({
      subject,
      chatId: body.chatId,
      agentId: body.agentId,
      content: body.content,
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      ...(body.historyBoundaryMessageId === undefined ? {} : { historyBoundaryMessageId: body.historyBoundaryMessageId }),
      ...(body.attachments === undefined ? {} : { attachments: body.attachments })
    })
    return context.json({ data }, 202)
  })

  app.get('/api/v1/runs/:runId', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').runs.get(context.req.param('runId'), subject)
    return context.json({ data })
  })

  app.get('/api/v1/runs/:runId/events', (context) => {
    const subject = context.get('subject')
    const events = context.get('services').runs.events(context.req.param('runId'), subject)
    return new Response(createSseStream(events), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      }
    })
  })

  app.post('/api/v1/runs/:runId/cancel', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').runs.cancel(context.req.param('runId'), subject)
    return context.json({ data })
  })
}
