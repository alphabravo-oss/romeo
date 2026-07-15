import type { RomeoApi } from '../context'

export function registerUsageRoutes(app: RomeoApi): void {
  app.get('/api/v1/usage/events', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').usage.list(subject)
    return context.json({ data })
  })

  app.get('/api/v1/usage/events.csv', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').usage.exportEventsCsv(subject)
    return context.text(data, 200, {
      'content-disposition': 'attachment; filename="romeo-usage-events.csv"',
      'content-type': 'text/csv; charset=utf-8'
    })
  })

  app.get('/api/v1/usage/summary', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').usage.summary(subject)
    return context.json({ data })
  })

  app.get('/api/v1/usage/alerts', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').usage.alerts(subject)
    return context.json({ data })
  })
}
