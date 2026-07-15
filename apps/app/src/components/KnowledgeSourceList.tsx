import { useMemo } from 'react'

import type { KnowledgeSource } from '../api/types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<KnowledgeSource>()

export function KnowledgeSourceList({
  isDeleting,
  isExtracting,
  isReindexing,
  onDelete,
  onExtract,
  onReindex,
  sources
}: {
  isDeleting: boolean
  isExtracting: boolean
  isReindexing: boolean
  onDelete: (sourceId: string) => void
  onExtract: (sourceId: string) => void
  onReindex: (sourceId: string) => void
  sources: KnowledgeSource[]
}) {
  const columns = useMemo<ColumnDef<KnowledgeSource, any>[]>(
    () => [
      col.accessor('fileName', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      col.accessor('mimeType', {
        header: 'Type',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      col.accessor('status', {
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'indexed' ? 'pass' : c.getValue() === 'failed' ? 'fail' : 'warn'}`}>
            {c.getValue()}
          </span>
        )
      }),
      col.accessor((row) => row.chunkCount ?? 0, {
        id: 'chunks',
        header: 'Chunks',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <div className="flex gap-2">
            <button className="rm-button" disabled={isReindexing} onClick={() => onReindex(c.row.original.id)} type="button">
              Reindex
            </button>
            <button className="rm-button" disabled={isExtracting || c.row.original.status !== 'pending'} onClick={() => onExtract(c.row.original.id)} type="button">
              Extract
            </button>
            <button className="rm-button" disabled={isDeleting} onClick={() => onDelete(c.row.original.id)} type="button">
              Delete
            </button>
          </div>
        )
      })
    ],
    [isDeleting, isExtracting, isReindexing, onDelete, onExtract, onReindex]
  )

  return (
    <div className="mt-3">
      <DataTable columns={columns} data={sources} empty="No knowledge sources yet." />
    </div>
  )
}
