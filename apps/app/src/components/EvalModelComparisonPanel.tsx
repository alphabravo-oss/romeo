import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { compareEvalModels } from '../api/client'
import { toast } from '../lib/toast'
import type { Agent, BaseModel, EvalModelComparison, EvalSuite } from '../api/types'

interface EvalModelComparisonPanelProps {
  activeAgent: Agent | undefined
  activeSuite: EvalSuite | undefined
  models: BaseModel[]
}

export function EvalModelComparisonPanel({ activeAgent, activeSuite, models }: EvalModelComparisonPanelProps) {
  const queryClient = useQueryClient()
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<EvalModelComparison>()
  const enabledModels = useMemo(() => models.filter((model) => model.enabled), [models])
  const modelSelectionKey = enabledModels.map((model) => model.id).join('|')
  const compareMutation = useMutation({ mutationFn: compareEvalModels })
  const selectedCount = selectedModelIds.length
  const canCompare = activeSuite !== undefined && selectedCount >= 2 && selectedCount <= 5 && !compareMutation.isPending

  useEffect(() => {
    const nextSelection = defaultSelectedModelIds(enabledModels, activeAgent?.baseModelId)
    setSelectedModelIds(nextSelection)
    setComparison(undefined)
  }, [activeAgent?.id, activeAgent?.baseModelId, modelSelectionKey])

  async function handleCompare() {
    if (!activeSuite || !activeAgent || !canCompare) return
    try {
      const nextComparison = await compareMutation.mutateAsync({ suiteId: activeSuite.id, modelIds: selectedModelIds })
      setComparison(nextComparison)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['evalRuns', activeAgent.id] }),
        queryClient.invalidateQueries({ queryKey: ['evalDashboard', activeAgent.id] })
      ])
      toast('Models compared', 'success')
    } catch {
      toast('Could not compare models', 'error')
    }
  }

  function handleToggle(modelId: string) {
    setSelectedModelIds((current) => {
      if (current.includes(modelId)) return current.filter((selectedModelId) => selectedModelId !== modelId)
      if (current.length >= 5) return current
      return [...current, modelId]
    })
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="rm-card-header">
        <div>
          <div className="text-sm font-medium">Model comparison</div>
          <div className="text-xs text-muted">{selectedCount} selected</div>
        </div>
        <button className="rm-button" disabled={!canCompare} onClick={() => void handleCompare()} type="button">
          {compareMutation.isPending ? 'Comparing' : 'Compare'}
        </button>
      </div>

      <div className="grid gap-2">
        {enabledModels.slice(0, 8).map((model) => {
          const selected = selectedModelIds.includes(model.id)
          return (
            <label
              className={`flex min-w-0 items-center gap-2 rounded-md border border-border p-2 ${selected ? 'bg-background' : ''}`}
              key={model.id}
            >
              <input checked={selected} onChange={() => handleToggle(model.id)} type="checkbox" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{model.displayName}</span>
                <span className="block truncate text-xs text-muted">{model.id}</span>
              </span>
            </label>
          )
        })}
      </div>

      {compareMutation.error instanceof Error ? <div className="mt-3 text-sm text-red-600">{compareMutation.error.message}</div> : null}

      {comparison ? (
        <div className="mt-3 grid gap-2">
          {comparison.comparisons.map((item) => (
            <div className="rounded-md border border-border p-2" key={item.runId}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{item.modelId}</span>
                <span className={item.status === 'passed' ? 'text-green-700' : 'text-red-600'}>{Math.round(item.score * 100)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent" style={{ width: `${Math.round(item.score * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted">
                {item.status} - {item.passedResultCount}/{item.resultCount}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function defaultSelectedModelIds(models: BaseModel[], baseModelId: string | undefined): string[] {
  const selected = new Set<string>()
  if (baseModelId !== undefined && models.some((model) => model.id === baseModelId)) selected.add(baseModelId)
  for (const model of models) {
    if (selected.size >= 2) break
    selected.add(model.id)
  }
  return [...selected].slice(0, 5)
}
