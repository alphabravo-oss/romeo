import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'

import { toast } from '../lib/toast'
import type { BaseModel } from '../api/types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { PanelStats } from './PanelStats'

const perMillion = 1_000_000

const col = createColumnHelper<BaseModel>()

const columns: ColumnDef<BaseModel, any>[] = [
  col.accessor('displayName', {
    header: 'Model',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>
  }),
  col.accessor('providerId', {
    header: 'Provider',
    cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
  }),
  col.accessor((row) => (row.pricing?.inputTokenUsd ?? 0) * perMillion, {
    id: 'input',
    header: 'Input / 1M',
    cell: (c) => <span className="rm-mono">${c.getValue().toFixed(2)}</span>
  }),
  col.accessor((row) => (row.pricing?.outputTokenUsd ?? 0) * perMillion, {
    id: 'output',
    header: 'Output / 1M',
    cell: (c) => <span className="rm-mono">${c.getValue().toFixed(2)}</span>
  }),
  col.accessor((row) => (row.enabled ? 'enabled' : 'disabled'), {
    id: 'status',
    header: 'Status',
    cell: (c) => (
      <span className={`rm-status ${c.getValue() === 'enabled' ? 'pass' : 'fail'}`}>{c.getValue()}</span>
    )
  })
]

export function ModelPricingPanel({
  isUpdating,
  models,
  onUpdatePricing
}: {
  isUpdating: boolean
  models: BaseModel[]
  onUpdatePricing: (input: { inputTokenUsd: number; modelId: string; outputTokenUsd: number }) => void
}) {
  const form = useForm({
    defaultValues: {
      modelId: '',
      inputMillionUsd: '0',
      outputMillionUsd: '0'
    },
    onSubmit: async ({ value }) => {
      const selectedModel = models.find((model) => model.id === value.modelId)
      if (selectedModel === undefined) return
      try {
        onUpdatePricing({
          modelId: selectedModel.id,
          inputTokenUsd: Number(value.inputMillionUsd) / perMillion,
          outputTokenUsd: Number(value.outputMillionUsd) / perMillion
        })
        toast('Pricing saved', 'success')
      } catch {
        toast('Could not save pricing', 'error')
      }
    }
  })

  const modelId = useStore(form.store, (state) => state.values.modelId)
  const selectedModel = useMemo(() => models.find((model) => model.id === modelId), [modelId, models])

  useEffect(() => {
    if (modelId === '' && models[0] !== undefined) form.setFieldValue('modelId', models[0].id)
  }, [modelId, models])

  useEffect(() => {
    if (selectedModel === undefined) return
    form.setFieldValue('inputMillionUsd', String((selectedModel.pricing?.inputTokenUsd ?? 0) * perMillion))
    form.setFieldValue('outputMillionUsd', String((selectedModel.pricing?.outputTokenUsd ?? 0) * perMillion))
  }, [selectedModel])

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Model pricing</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="model-pricing-model">
          Model
        </label>
        <form.Field name="modelId">
          {(field) => (
            <select
              className="rm-input"
              id="model-pricing-model"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              value={field.state.value}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <label className="text-sm text-muted" htmlFor="model-pricing-input">
          Input USD per 1M tokens
        </label>
        <form.Field name="inputMillionUsd">
          {(field) => (
            <input
              className="rm-input"
              id="model-pricing-input"
              min="0"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              step="0.01"
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <label className="text-sm text-muted" htmlFor="model-pricing-output">
          Output USD per 1M tokens
        </label>
        <form.Field name="outputMillionUsd">
          {(field) => (
            <input
              className="rm-input"
              id="model-pricing-output"
              min="0"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              step="0.01"
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={isUpdating || !canSubmit || isSubmitting || selectedModel === undefined} type="submit">
              {isUpdating ? 'Saving' : 'Save pricing'}
            </button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-4 grid gap-4">
        <PanelStats
          items={[
            { label: 'Total models', value: models.length },
            { label: 'With pricing', value: models.filter((model) => model.pricing !== undefined).length }
          ]}
        />
        <DataTable columns={columns} data={models} empty="No models yet." />
      </div>
    </section>
  )
}
