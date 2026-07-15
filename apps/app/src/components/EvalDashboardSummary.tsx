import type { EvalDashboard } from '../api/types'

export function EvalDashboardSummary({ dashboard }: { dashboard: EvalDashboard | undefined }) {
  if (dashboard === undefined) return null
  const average = dashboard.averageLatestScore === null ? 'n/a' : `${Math.round(dashboard.averageLatestScore * 100)}%`
  return (
    <div className="rounded-md border border-border p-3">
      <div className="rm-card-header">
        <div>
          <div className="font-medium">Eval dashboard</div>
          <div className="text-xs text-muted">{dashboard.status}</div>
        </div>
        <div className="text-right">
          <div className="font-medium">{average}</div>
          <div className="text-xs text-muted">{dashboard.runCount} runs</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="Suites" value={dashboard.suiteCount} />
        <Metric label="Passed" value={dashboard.suites.filter((suite) => suite.status === 'passed').length} />
        <Metric label="Missing" value={dashboard.suites.filter((suite) => suite.status === 'missing').length} />
      </div>

      {dashboard.trend.length > 0 ? (
        <div className="mt-3 flex h-16 items-end gap-1 rounded-md bg-background p-2">
          {dashboard.trend.slice(-12).map((point) => (
            <div
              aria-label={`${point.status} ${Math.round(point.score * 100)}%`}
              className={point.status === 'passed' ? 'min-w-2 flex-1 rounded-sm bg-accent' : 'min-w-2 flex-1 rounded-sm bg-red-500'}
              key={point.runId}
              style={{ height: `${Math.max(8, Math.round(point.score * 100))}%` }}
              title={`${point.modelId} ${Math.round(point.score * 100)}%`}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2">
        {dashboard.suites.slice(0, 3).map((suite) => (
          <div className="flex min-w-0 items-center justify-between gap-2 text-xs" key={suite.suiteId}>
            <span className="min-w-0 truncate">{suite.name}</span>
            <span className="text-muted">{suite.score === null ? suite.status : `${Math.round(suite.score * 100)}%`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background p-2">
      <div className="font-medium">{value}</div>
      <div className="text-muted">{label}</div>
    </div>
  )
}
