import { useQuery } from '@tanstack/react-query'

import { listToolCalls } from '../api/tools'
import type { ToolCallRecord } from '../api/tool-types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<ToolCallRecord>()

const columns: ColumnDef<ToolCallRecord, any>[] = [
  col.accessor('toolId', {
    header: 'Tool',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (c) => {
      const status = c.getValue()
      const tone = status === 'success' ? 'pass' : status === 'failure' || status === 'blocked' ? 'fail' : 'warn'
      return <span className={`rm-status ${tone}`}>{status}</span>
    },
  }),
  col.accessor((row) => row.inputKeys.join(', ') || 'none', {
    id: 'input',
    header: 'Input',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  col.accessor((row) => (row.outputKeys.join(', ') || row.errorCode) ?? 'none', {
    id: 'output',
    header: 'Output',
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  col.accessor('runId', {
    header: 'Run',
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue() ?? '-'}</span>,
  }),
]

export function ToolTracePanel({ activeAgentId }: { activeAgentId: string | undefined }) {
  const callsQuery = useQuery({
    queryKey: ['toolCalls', activeAgentId],
    queryFn: () => listToolCalls(activeAgentId),
    enabled: activeAgentId !== undefined
  })
  const calls = callsQuery.data ?? []

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">Tool calls</div>
        <button className="rm-button" disabled={callsQuery.isFetching || activeAgentId === undefined} onClick={() => void callsQuery.refetch()} type="button">
          {callsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <DataTable columns={columns} data={calls} empty="No tool calls yet." />
    </section>
  )
}
