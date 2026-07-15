import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { exportUsageEventsCsv, getUsageSummary, listUsageAlerts, listUsageEvents } from '../api/client'
import type { UsageAlert, UsageEvent, UsageSummaryMetric } from '../api/types'
import { downloadCsv } from '../lib/csv'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const alertCol = createColumnHelper<UsageAlert>()

const alertColumns: ColumnDef<UsageAlert, any>[] = [
  alertCol.accessor('severity', {
    header: 'Severity',
    cell: (c) => <span className="font-medium">{c.getValue().toUpperCase()}</span>
  }),
  alertCol.accessor('metric', {
    header: 'Metric',
    cell: (c) => <span className="rm-mono">{c.getValue()}</span>
  }),
  alertCol.accessor((row) => Math.round(row.percentUsed * 100), {
    id: 'percentUsed',
    header: 'Used %',
    cell: (c) => <span>{c.getValue()}%</span>
  }),
  alertCol.accessor((row) => `${row.scopeType}:${row.scopeId}`, {
    id: 'scope',
    header: 'Scope',
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
  })
]

const totalCol = createColumnHelper<UsageSummaryMetric>()

const totalColumns: ColumnDef<UsageSummaryMetric, any>[] = [
  totalCol.accessor('metric', {
    header: 'Metric',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>
  }),
  totalCol.accessor('quantity', {
    header: 'Quantity',
    cell: (c) => <span>{c.getValue()}</span>
  }),
  totalCol.accessor('unit', {
    header: 'Unit',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
  }),
  totalCol.accessor('estimatedCostUsd', {
    header: 'Est. cost',
    cell: (c) => <span className="rm-cell-muted">{c.getValue() > 0 ? formatUsd(c.getValue()) : '-'}</span>
  })
]

const eventCol = createColumnHelper<UsageEvent>()

const eventColumns: ColumnDef<UsageEvent, any>[] = [
  eventCol.accessor('createdAt', {
    header: 'Time',
    cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
  }),
  eventCol.accessor('metric', {
    header: 'Metric',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>
  }),
  eventCol.accessor('quantity', {
    header: 'Quantity',
    cell: (c) => <span>{c.getValue()}</span>
  }),
  eventCol.accessor('unit', {
    header: 'Unit',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
  }),
  eventCol.accessor('sourceType', {
    header: 'Source',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
  })
]

export function UsagePanel() {
  const usageQuery = useQuery({ queryKey: ['usageEvents'], queryFn: listUsageEvents })
  const summaryQuery = useQuery({ queryKey: ['usageSummary'], queryFn: getUsageSummary })
  const alertsQuery = useQuery({ queryKey: ['usageAlerts'], queryFn: listUsageAlerts })
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const alerts = alertsQuery.data ?? []
  const events = usageQuery.data ?? []
  const totals = summaryQuery.data?.totals ?? []

  return (
    <section className="rm-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">Usage</div>
        <div className="flex flex-wrap gap-2">
          <button className="rm-button" disabled={isExporting || events.length === 0} onClick={() => void exportCsv()} type="button">
            {isExporting ? 'Exporting' : 'Export CSV'}
          </button>
          <button className="rm-button" disabled={usageQuery.isFetching || summaryQuery.isFetching || alertsQuery.isFetching} onClick={() => void refresh()} type="button">
            {usageQuery.isFetching || summaryQuery.isFetching || alertsQuery.isFetching ? 'Refreshing' : 'Refresh usage'}
          </button>
        </div>
      </div>
      {exportError ? <div className="mb-3 text-sm text-red-300">{exportError}</div> : null}
      {alerts.length > 0 ? (
        <>
          <div className="mb-2 mt-3 text-xs font-medium text-muted">Alerts</div>
          <DataTable columns={alertColumns} data={alerts} empty="No usage alerts." />
        </>
      ) : null}
      <div className="mb-2 mt-3 text-xs font-medium text-muted">Totals</div>
      <DataTable columns={totalColumns} data={totals} empty="No usage totals yet." />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">Events</div>
      <DataTable columns={eventColumns} data={events} empty="No usage events yet." />
    </section>
  )

  async function refresh() {
    await Promise.all([usageQuery.refetch(), summaryQuery.refetch(), alertsQuery.refetch()])
  }

  async function exportCsv() {
    setExportError(undefined)
    setIsExporting(true)
    try {
      const csv = await exportUsageEventsCsv()
      downloadCsv(csv, 'romeo-usage-events.csv')
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : 'Unable to export usage events.')
    } finally {
      setIsExporting(false)
    }
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`
}
