import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { createQuotaBucket, deleteQuotaBucket, listQuotas, updateQuotaBucket } from '../api/client'
import type { QuotaBucket } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { useWorkspace } from './WorkspaceContext'

const quotaCol = createColumnHelper<QuotaBucket>()

const quotaMetrics: QuotaBucket['metric'][] = ['run.started', 'tool.call', 'storage.byte']
const quotaScopeTypes: QuotaBucket['scopeType'][] = ['org', 'user', 'workspace', 'provider', 'agent', 'api_key']

export function QuotaPanel() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspace()
  const { ask, dialog } = useConfirm()
  const quotasQuery = useQuery({ queryKey: ['quotas'], queryFn: listQuotas })
  const createMutation = useMutation({ mutationFn: createQuotaBucket })
  const deleteMutation = useMutation({ mutationFn: deleteQuotaBucket })
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<QuotaBucket | null>(null)

  const quotaForm = useForm({
    defaultValues: {
      scopeType: 'org' as QuotaBucket['scopeType'],
      scopeId: '',
      metric: 'tool.call' as QuotaBucket['metric'],
      limit: 25,
      resetInterval: 'none' as QuotaBucket['resetInterval']
    },
    onSubmit: async ({ value }) => {
      try {
        const input: Parameters<typeof createQuotaBucket>[0] = {
          scopeType: value.scopeType,
          metric: value.metric,
          limit: value.limit,
          resetInterval: value.resetInterval
        }
        if (requiresScopeId(value.scopeType)) {
          input.scopeId = value.scopeType === 'workspace' ? (workspaceId ?? value.scopeId) : value.scopeId
        }
        await createMutation.mutateAsync(input)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['quotas'] }),
          queryClient.invalidateQueries({ queryKey: ['usageAlerts'] })
        ])
        toast('Quota saved', 'success')
        setAddOpen(false)
      } catch (caught) {
        toast('Could not save quota', 'error')
        throw caught
      }
    }
  })

  const columns = useMemo<ColumnDef<QuotaBucket, any>[]>(
    () => [
      quotaCol.accessor('metric', {
        header: 'Metric',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      quotaCol.accessor((row) => `${row.scopeType}:${row.scopeId}`, {
        id: 'scope',
        header: 'Scope',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      quotaCol.accessor((row) => `${row.used}/${row.limit}`, {
        id: 'usage',
        header: 'Used / Limit',
        cell: (c) => <span>{c.getValue()}</span>
      }),
      quotaCol.accessor('resetInterval', {
        header: 'Reset',
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue()}
            {c.row.original.resetAt ? ` - resets ${new Date(c.row.original.resetAt).toLocaleDateString()}` : ''}
          </span>
        )
      }),
      quotaCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <div className="flex items-center gap-2">
            <button className="rm-button" onClick={() => setEditing(c.row.original)} type="button">
              Edit
            </button>
            <button
              className="rm-button"
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete(c.row.original.id)}
              type="button"
            >
              Delete
            </button>
          </div>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteMutation.isPending]
  )

  async function handleDelete(quotaBucketId: string) {
    if (!(await ask({ title: 'Delete quota?', confirmLabel: 'Delete', tone: 'danger' }))) return
    try {
      await deleteMutation.mutateAsync(quotaBucketId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['quotas'] }),
        queryClient.invalidateQueries({ queryKey: ['usageAlerts'] })
      ])
      toast('Quota removed', 'success')
    } catch {
      toast('Could not remove quota', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">Quotas</div>
        <div className="flex items-center gap-2">
          <button className="rm-button" disabled={quotasQuery.isFetching} onClick={() => void quotasQuery.refetch()} type="button">
            {quotasQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
            + Add quota
          </button>
        </div>
      </div>
      <FormDialog open={addOpen} title="New quota" onClose={() => setAddOpen(false)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void quotaForm.handleSubmit()
        }}
      >
        <quotaForm.Field name="scopeType">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as QuotaBucket['scopeType'])}
              value={field.state.value}
            >
              {quotaScopeTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </quotaForm.Field>
        <quotaForm.Subscribe selector={(state) => state.values.scopeType}>
          {(scopeType) =>
            requiresScopeId(scopeType) ? (
              <quotaForm.Field
                name="scopeId"
                validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Scope id is required' : undefined) }}
              >
                {(field) => (
                  <>
                    <input
                      className="rm-input"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      placeholder={`${scopeType} id`}
                      value={field.state.value}
                    />
                    {field.state.meta.errors.length ? (
                      <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                    ) : null}
                  </>
                )}
              </quotaForm.Field>
            ) : null
          }
        </quotaForm.Subscribe>
        <quotaForm.Field name="metric">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as QuotaBucket['metric'])}
              value={field.state.value}
            >
              {quotaMetrics.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </quotaForm.Field>
        <quotaForm.Field name="limit">
          {(field) => (
            <input
              className="rm-input"
              min={0}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(Number(event.currentTarget.value))}
              type="number"
              value={field.state.value}
            />
          )}
        </quotaForm.Field>
        <quotaForm.Field name="resetInterval">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as QuotaBucket['resetInterval'])}
              value={field.state.value}
            >
              <option value="none">No reset</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
        </quotaForm.Field>
        <quotaForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Saving' : 'Save quota'}
            </button>
          )}
        </quotaForm.Subscribe>
      </form>
      </FormDialog>
      {editing !== null ? (
        <QuotaEditDialog
          key={editing.id}
          quota={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['quotas'] })
            setEditing(null)
          }}
        />
      ) : null}
      <div className="mt-4">
        <PanelState
          query={quotasQuery}
          empty="No quotas yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add quota
            </button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total buckets', value: rows.length },
                  { label: 'With reset', value: rows.filter((row) => row.resetInterval !== 'none').length }
                ]}
              />
              <DataTable columns={columns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>
      {dialog}
    </section>
  )
}

function QuotaEditDialog({
  quota,
  onClose,
  onSaved
}: {
  quota: QuotaBucket
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const editForm = useForm({
    defaultValues: {
      limit: quota.limit,
      resetInterval: quota.resetInterval
    },
    onSubmit: async ({ value }) => {
      try {
        await updateQuotaBucket(quota.id, { limit: value.limit, resetInterval: value.resetInterval })
        toast('Quota updated', 'success')
        await onSaved()
      } catch (caught) {
        toast('Could not update quota', 'error')
        throw caught
      }
    }
  })

  return (
    <FormDialog open title="Edit quota" description={`${quota.scopeType}:${quota.scopeId}`} onClose={onClose}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void editForm.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="quota-edit-limit">
          Limit
        </label>
        <editForm.Field name="limit">
          {(field) => (
            <input
              className="rm-input"
              id="quota-edit-limit"
              min={0}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(Number(event.currentTarget.value))}
              type="number"
              value={field.state.value}
            />
          )}
        </editForm.Field>
        <label className="text-sm text-muted" htmlFor="quota-edit-reset">
          Reset
        </label>
        <editForm.Field name="resetInterval">
          {(field) => (
            <select
              className="rm-input"
              id="quota-edit-reset"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as QuotaBucket['resetInterval'])}
              value={field.state.value}
            >
              <option value="none">No reset</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
        </editForm.Field>
        <editForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Saving' : 'Save quota'}
            </button>
          )}
        </editForm.Subscribe>
      </form>
    </FormDialog>
  )
}

function requiresScopeId(scopeType: QuotaBucket['scopeType']): boolean {
  return scopeType !== 'org' && scopeType !== 'user'
}
