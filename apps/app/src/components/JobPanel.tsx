import { useQuery } from '@tanstack/react-query'

import { listJobs } from '../api/client'
import type { BackgroundJob } from '../api/admin-types'
import { PanelState } from '../lib/panel-state'
import { PanelStats } from './PanelStats'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<BackgroundJob>()

const columns: ColumnDef<BackgroundJob, any>[] = [
  col.accessor('type', {
    header: 'Type',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  col.accessor('id', {
    header: 'ID',
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (c) => {
      const status = c.getValue()
      const tone = status === 'completed' ? 'pass' : status === 'failed' ? 'fail' : 'warn'
      return <span className={`rm-status ${tone}`}>{status}</span>
    },
  }),
  col.accessor('updatedAt', {
    header: 'Updated',
    cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>,
  }),
]

export function JobPanel() {
  const jobsQuery = useQuery({ queryKey: ['jobs'], queryFn: listJobs })

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">Jobs</div>
        <button className="rm-button" disabled={jobsQuery.isFetching} onClick={() => void jobsQuery.refetch()} type="button">
          {jobsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={jobsQuery} empty="No background jobs yet.">
        {(jobs) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Total jobs', value: jobs.length },
                { label: 'Running', value: jobs.filter((job) => job.status === 'running').length },
                { label: 'Failed', value: jobs.filter((job) => job.status === 'failed').length },
              ]}
            />
            <DataTable columns={columns} data={jobs} empty="No background jobs yet." />
          </div>
        )}
      </PanelState>
    </section>
  )
}
