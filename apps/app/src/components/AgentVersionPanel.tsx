import { useMemo } from 'react'

import type { Agent, AgentVersion, AgentVersionDiff } from '../api/types'
import { AgentVersionDiffSummary } from './AgentVersionDiffSummary'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<AgentVersion>()

interface AgentVersionPanelProps {
  activeAgent: Agent | undefined
  diff: AgentVersionDiff | undefined
  isComparing: boolean
  isRollingBack: boolean
  leftVersionId: string
  onCompare: () => void
  onLeftVersionChange: (versionId: string) => void
  onRightVersionChange: (versionId: string) => void
  onRollback: (versionId: string) => void
  rightVersionId: string
  versions: AgentVersion[]
}

export function AgentVersionPanel({
  activeAgent,
  diff,
  isComparing,
  isRollingBack,
  leftVersionId,
  onCompare,
  onLeftVersionChange,
  onRightVersionChange,
  onRollback,
  rightVersionId,
  versions
}: AgentVersionPanelProps) {
  const columns = useMemo<ColumnDef<AgentVersion, any>[]>(
    () => [
      col.accessor('version', {
        header: 'Version',
        cell: (c) => <span className="font-medium">Version {c.getValue()}</span>
      }),
      col.accessor('publishedAt', {
        header: 'Published',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
      }),
      col.accessor((row) => row.evalSummary?.status ?? '', {
        id: 'evals',
        header: 'Evals',
        cell: (c) => {
          const summary = c.row.original.evalSummary
          if (!summary) return <span className="rm-cell-muted">-</span>
          return (
            <span className={`rm-status ${summary.status === 'passed' ? 'pass' : summary.status === 'failed' ? 'fail' : 'warn'}`}>
              {summary.status} {summary.passedSuiteCount}/{summary.suiteCount}
              {summary.averageScore === null ? '' : ` - ${Math.round(summary.averageScore * 100)}%`}
            </span>
          )
        }
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className="rm-button"
            disabled={activeAgent?.publishedVersionId === c.row.original.id || isRollingBack}
            onClick={() => onRollback(c.row.original.id)}
            type="button"
          >
            {activeAgent?.publishedVersionId === c.row.original.id ? 'Current' : 'Rollback'}
          </button>
        )
      })
    ],
    [activeAgent?.publishedVersionId, isRollingBack, onRollback]
  )

  return (
    <>
      <div className="mt-5">
        <div className="mb-2 text-sm text-muted">Versions</div>
        <DataTable columns={columns} data={versions} empty="No published versions." />
      </div>

      <div className="mt-5 grid gap-2">
        <div className="text-sm text-muted">Diff</div>
        <select className="rm-input" onChange={(event) => onLeftVersionChange(event.currentTarget.value)} value={leftVersionId}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              Version {version.version}
            </option>
          ))}
        </select>
        <select className="rm-input" onChange={(event) => onRightVersionChange(event.currentTarget.value)} value={rightVersionId}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              Version {version.version}
            </option>
          ))}
        </select>
        <button className="rm-button" disabled={versions.length < 2 || isComparing} onClick={onCompare} type="button">
          {isComparing ? 'Comparing' : 'Compare'}
        </button>
        {diff ? <AgentVersionDiffSummary diff={diff} /> : null}
      </div>
    </>
  )
}
