import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { listOrganizations } from '../api/organizations-client'
import type { Organization } from '../api/organizations-types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const orgCol = createColumnHelper<Organization>()

export function OrganizationsPanel() {
  const organizationsQuery = useQuery({ queryKey: ['organizations'], queryFn: listOrganizations })

  const columns = useMemo<ColumnDef<Organization, any>[]>(
    () => [
      orgCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      orgCol.accessor('slug', {
        header: 'Slug',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      orgCol.accessor('id', {
        header: 'ID',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      })
    ],
    []
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Organizations</div>
        <button
          className="rm-button"
          disabled={organizationsQuery.isFetching}
          onClick={() => void organizationsQuery.refetch()}
          type="button"
        >
          {organizationsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-4">
        <DataTable columns={columns} data={organizationsQuery.data ?? []} empty="No organizations yet." />
      </div>
    </section>
  )
}
