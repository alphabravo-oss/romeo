import type { DataConnectorSync } from '../api/types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<DataConnectorSync>()

const columns: ColumnDef<DataConnectorSync, any>[] = [
  col.accessor('startedAt', {
    header: 'Started',
    cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
  }),
  col.accessor((row) => row.completedAt, {
    id: 'finished',
    header: 'Finished',
    cell: (c) => (
      <span className="rm-cell-muted">{c.getValue() ? new Date(c.getValue()).toLocaleString() : 'running'}</span>
    )
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (c) => (
      <span className={`rm-status ${c.getValue() === 'completed' ? 'pass' : c.getValue() === 'failed' ? 'fail' : 'warn'}`}>
        {c.getValue()}
      </span>
    )
  }),
  col.accessor('itemCount', {
    header: 'Items',
    cell: (c) => <span className="rm-mono">{c.getValue()}</span>
  }),
  col.accessor((row) => (row.errorCode ? connectorErrorLabel(row.errorCode) : ''), {
    id: 'message',
    header: 'Message',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
  })
]

export function DataConnectorSyncHistory({ syncs }: { syncs: DataConnectorSync[] }) {
  const latestFailure = syncs.find((sync) => sync.status === 'failed')
  return (
    <div className="mt-3 grid gap-2 text-xs">
      {latestFailure ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900">
          <div className="font-medium">Latest sync failed</div>
          <div>{connectorErrorLabel(latestFailure.errorCode)}</div>
          {latestFailure.errorCode ? <div className="break-words text-red-700">{latestFailure.errorCode}</div> : null}
        </div>
      ) : null}

      <DataTable columns={columns} data={syncs} empty="No syncs yet." />
    </div>
  )
}

function connectorErrorLabel(code: string | undefined): string {
  if (code === 'connector_execution_disabled') return 'Managed connector execution is disabled.'
  if (code === 'connector_egress_host_blocked') return 'The connector host is outside the configured allowlist.'
  if (code === 'connector_response_too_large') return 'The remote response exceeded the configured byte limit.'
  if (code === 'private_network_host_blocked') return 'The connector URL targets a private or local host.'
  if (code === undefined) return 'The sync did not complete.'
  return 'The sync did not complete.'
}
