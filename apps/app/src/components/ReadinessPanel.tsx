import { useQuery } from '@tanstack/react-query'

import { getReadinessReport } from '../api/client'
import { PanelState } from '../lib/panel-state'
import { PanelStats } from './PanelStats'

const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }

export function ReadinessPanel() {
  const readinessQuery = useQuery({ queryKey: ['readiness'], queryFn: getReadinessReport })

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Readiness</div>
        <button className="rm-button" disabled={readinessQuery.isFetching} onClick={() => void readinessQuery.refetch()} type="button">
          {readinessQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-4">
        <PanelState query={readinessQuery} isEmpty={(report) => report.checks.length === 0} empty="No readiness checks reported.">
          {(report) => {
            const pass = report.checks.filter((check) => check.status === 'pass').length
            const warn = report.checks.filter((check) => check.status === 'warn').length
            const fail = report.checks.filter((check) => check.status === 'fail').length
            const checks = [...report.checks].sort(
              (a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3)
            )
            return (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className={`rm-status ${report.status === 'ready' ? 'ok' : 'warn'} text-sm font-medium`}>
                    {report.status === 'ready' ? 'Ready' : 'Attention required'}
                  </span>
                  <span className="text-xs text-muted">Generated {new Date(report.generatedAt).toLocaleString()}</span>
                </div>
                <PanelStats
                  items={[
                    { label: 'Passing', value: pass },
                    { label: 'Warnings', value: warn },
                    { label: 'Failing', value: fail }
                  ]}
                />
                <div className="grid gap-2">
                  {checks.map((check) => (
                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3" key={check.id}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{check.id}</div>
                        <div className="mt-0.5 break-words text-sm text-muted">{check.message}</div>
                      </div>
                      <span className={`rm-status ${check.status} shrink-0 whitespace-nowrap text-xs font-medium`}>
                        {check.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          }}
        </PanelState>
      </div>
    </section>
  )
}
