import type { RomeoApi } from '../context'
import type { AuditLogFilter, AuditLogPageOptions } from '../../services/audit-service'

export function registerAuditRoutes(app: RomeoApi): void {
  app.get('/api/v1/audit-logs', async (context) => {
    const subject = context.get('subject')
    const options: AuditLogPageOptions = { filter: auditFilter(context) }
    const limit = parseLimit(context.req.query('limit'))
    if (limit !== undefined) options.limit = limit
    const cursor = context.req.query('cursor')
    if (cursor !== undefined) options.cursor = cursor
    const page = await context.get('services').audit.listPage(subject, options)
    return page.nextCursor !== undefined
      ? context.json({ data: page.data, nextCursor: page.nextCursor })
      : context.json({ data: page.data })
  })

  app.get('/api/v1/audit-logs.csv', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').audit.exportCsv(subject, auditFilter(context))
    return context.text(data, 200, {
      'content-disposition': 'attachment; filename="romeo-audit-logs.csv"',
      'content-type': 'text/csv; charset=utf-8'
    })
  })
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function auditFilter(context: { req: { query: (name: string) => string | undefined } }): AuditLogFilter {
  const filter: AuditLogFilter = {}
  const action = context.req.query('action')
  const actorId = context.req.query('actorId')
  const outcome = context.req.query('outcome')
  const resourceId = context.req.query('resourceId')
  const resourceType = context.req.query('resourceType')
  if (action !== undefined) filter.action = action
  if (actorId !== undefined) filter.actorId = actorId
  if (outcome === 'success' || outcome === 'failure') filter.outcome = outcome
  if (resourceId !== undefined) filter.resourceId = resourceId
  if (resourceType !== undefined) filter.resourceType = resourceType
  return filter
}
