import { assertScope, type AuthSubject } from '@romeo/auth'

import type { AuditLog } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'

export class AuditService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject, filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    assertScope(subject, 'audit:read')
    const logs = await this.repository.listAuditLogs(subject.orgId)
    return filterAuditLogs(logs, filter)
  }

  async listPage(subject: AuthSubject, options: AuditLogPageOptions = {}): Promise<AuditLogPage> {
    const logs = await this.list(subject, options.filter ?? {})
    const limit = normalizeLimit(options.limit)
    const startIndex = options.cursor !== undefined ? indexAfterCursor(logs, options.cursor) : 0
    const slice = logs.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < logs.length
    const last = slice[slice.length - 1]
    if (hasMore && last !== undefined) {
      return { data: slice, nextCursor: encodeCursor(last) }
    }
    return { data: slice }
  }

  async exportCsv(subject: AuthSubject, filter: AuditLogFilter = {}): Promise<string> {
    const logs = await this.list(subject, filter)
    const rows = [['id', 'createdAt', 'actorId', 'action', 'resourceType', 'resourceId', 'outcome', 'metadataKeys']]
    for (const log of logs) {
      rows.push([
        log.id,
        log.createdAt,
        log.actorId,
        log.action,
        log.resourceType,
        log.resourceId,
        log.outcome,
        Object.keys(log.metadata).sort().join('|')
      ])
    }
    return rows.map((row) => row.map(csvCell).join(',')).join('\n')
  }
}

export interface AuditLogFilter {
  action?: string
  actorId?: string
  outcome?: 'failure' | 'success'
  resourceId?: string
  resourceType?: string
}

export const AUDIT_LOG_PAGE_DEFAULT_LIMIT = 50
export const AUDIT_LOG_PAGE_MAX_LIMIT = 1000

export interface AuditLogPageOptions {
  filter?: AuditLogFilter
  limit?: number
  cursor?: string
}

export interface AuditLogPage {
  data: AuditLog[]
  nextCursor?: string
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return AUDIT_LOG_PAGE_DEFAULT_LIMIT
  const truncated = Math.floor(limit)
  if (truncated < 1) return 1
  if (truncated > AUDIT_LOG_PAGE_MAX_LIMIT) return AUDIT_LOG_PAGE_MAX_LIMIT
  return truncated
}

// Cursor is an opaque token identifying the last row of the previous page.
// The list is already sorted newest-first; we page by (createdAt, id) so
// rows sharing a createdAt still paginate deterministically.
function encodeCursor(log: AuditLog): string {
  return Buffer.from(`${log.createdAt}|${log.id}`, 'utf8').toString('base64url')
}

function indexAfterCursor(logs: AuditLog[], cursor: string): number {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    return logs.length
  }
  const separator = decoded.lastIndexOf('|')
  if (separator === -1) return logs.length
  const id = decoded.slice(separator + 1)
  const position = logs.findIndex((log) => log.id === id)
  return position === -1 ? logs.length : position + 1
}

function filterAuditLogs(logs: AuditLog[], filter: AuditLogFilter): AuditLog[] {
  return logs.filter((log) => {
    if (filter.action !== undefined && log.action !== filter.action) return false
    if (filter.actorId !== undefined && log.actorId !== filter.actorId) return false
    if (filter.outcome !== undefined && log.outcome !== filter.outcome) return false
    if (filter.resourceId !== undefined && log.resourceId !== filter.resourceId) return false
    if (filter.resourceType !== undefined && log.resourceType !== filter.resourceType) return false
    return true
  })
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
