import type { UsageEvent } from '../domain/entities'

const usageCsvColumns = [
  'id',
  'createdAt',
  'actorId',
  'workspaceId',
  'sourceType',
  'sourceId',
  'metric',
  'quantity',
  'unit',
  'providerId',
  'modelId',
  'agentId',
  'estimatedCostUsd'
] as const

export function formatUsageEventsCsv(events: UsageEvent[]): string {
  const rows = events.map((event) => [
    event.id,
    event.createdAt,
    event.actorId,
    event.workspaceId ?? '',
    event.sourceType,
    event.sourceId,
    event.metric,
    event.quantity,
    event.unit,
    stringMetadata(event, 'providerId'),
    stringMetadata(event, 'modelId'),
    stringMetadata(event, 'agentId'),
    numberMetadata(event, 'estimatedCostUsd')
  ])
  return [usageCsvColumns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

function stringMetadata(event: UsageEvent, key: string): string {
  const value = event.metadata[key]
  return typeof value === 'string' ? value : ''
}

function numberMetadata(event: UsageEvent, key: string): number | '' {
  const value = event.metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
