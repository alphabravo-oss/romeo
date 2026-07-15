import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  applyBillingPlan,
  enforceBillingLifecycle,
  getBillingEntitlements,
  getBillingLifecycle,
  getBillingPlan,
  reconcileBillingEntitlements,
  syncExternalBillingEvent
} from '../api/billing-client'
import type {
  BillingEntitlementQuotaReport,
  BillingLifecycleReport,
  BillingPlanQuotaTemplate,
  BillingPlanStatus,
  ExternalBillingEventType
} from '../api/billing-types'
import { toast } from '../lib/toast'
import { PanelState } from '../lib/panel-state'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

const templateCol = createColumnHelper<BillingPlanQuotaTemplate>()
const entitlementCol = createColumnHelper<BillingEntitlementQuotaReport>()

const planStatuses: BillingPlanStatus[] = ['active', 'canceled', 'past_due', 'trialing']
const eventTypes: ExternalBillingEventType[] = [
  'customer.updated',
  'invoice.paid',
  'invoice.payment_failed',
  'subscription.canceled',
  'subscription.created',
  'subscription.updated'
]

const required = ({ value }: { value: string }) => (!value?.trim() ? 'Required' : undefined)

export function BillingPanel() {
  const queryClient = useQueryClient()
  const planQuery = useQuery({ queryKey: ['billingPlan'], queryFn: getBillingPlan })
  const applyMutation = useMutation({ mutationFn: applyBillingPlan })
  const syncMutation = useMutation({ mutationFn: syncExternalBillingEvent })

  const plan = planQuery.data ?? null

  const planForm = useForm({
    defaultValues: {
      code: 'pro',
      name: 'Pro',
      status: 'active' as BillingPlanStatus,
      metric: 'tool.call' as BillingPlanQuotaTemplate['metric'],
      limit: 1000,
      resetInterval: 'monthly' as BillingPlanQuotaTemplate['resetInterval']
    },
    onSubmit: async ({ value }) => {
      try {
        await applyMutation.mutateAsync({
          code: value.code,
          name: value.name,
          status: value.status,
          source: 'manual',
          quotaTemplates: [{ metric: value.metric, limit: value.limit, resetInterval: value.resetInterval }]
        })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['billingPlan'] }),
          queryClient.invalidateQueries({ queryKey: ['quotas'] })
        ])
        toast('Billing plan updated', 'success')
      } catch (caught) {
        toast('Could not update billing plan', 'error')
        throw caught
      }
    }
  })

  const eventForm = useForm({
    defaultValues: {
      provider: 'stripe',
      eventType: 'invoice.paid' as ExternalBillingEventType
    },
    onSubmit: async ({ value }) => {
      try {
        await syncMutation.mutateAsync({ provider: value.provider, eventType: value.eventType })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['billingPlan'] }),
          queryClient.invalidateQueries({ queryKey: ['quotas'] })
        ])
        toast('External event synced', 'success')
      } catch (caught) {
        toast('Could not sync external event', 'error')
        throw caught
      }
    }
  })

  const columns = useMemo<ColumnDef<BillingPlanQuotaTemplate, any>[]>(
    () => [
      templateCol.accessor('metric', {
        header: 'Metric',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      templateCol.accessor('limit', {
        header: 'Limit',
        cell: (c) => <span>{c.getValue()}</span>
      }),
      templateCol.accessor('resetInterval', {
        header: 'Reset',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Billing</div>
        <button
          className="rm-button"
          disabled={planQuery.isFetching}
          onClick={() => void planQuery.refetch()}
          type="button"
        >
          {planQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="text-sm text-muted mb-2">
        {plan ? (
          <span>
            Current plan: <span className="font-medium">{plan.name}</span> ({plan.code}) — {plan.status} / {plan.source}
          </span>
        ) : (
          <span>No billing plan configured.</span>
        )}
      </div>

      <Tabs
        tabs={[
          {
            id: 'plan',
            label: 'Plan',
            content: (
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void planForm.handleSubmit()
        }}
      >
        <planForm.Field name="code" validators={{ onChange: required }}>
          {(field) => (
            <input
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Plan code"
              value={field.state.value}
            />
          )}
        </planForm.Field>
        <planForm.Field name="name" validators={{ onChange: required }}>
          {(field) => (
            <input
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Plan name"
              value={field.state.value}
            />
          )}
        </planForm.Field>
        <planForm.Field name="status">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as BillingPlanStatus)}
              value={field.state.value}
            >
              {planStatuses.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </planForm.Field>
        <planForm.Field name="metric">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as BillingPlanQuotaTemplate['metric'])}
              value={field.state.value}
            >
              <option value="run.started">run.started</option>
              <option value="tool.call">tool.call</option>
              <option value="storage.byte">storage.byte</option>
            </select>
          )}
        </planForm.Field>
        <planForm.Field name="limit">
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
        </planForm.Field>
        <planForm.Field name="resetInterval">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value as BillingPlanQuotaTemplate['resetInterval'])
              }
              value={field.state.value}
            >
              <option value="none">No reset</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
        </planForm.Field>
        <planForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Saving' : 'Save plan'}
            </button>
          )}
        </planForm.Subscribe>
      </form>
            )
          },
          {
            id: 'quota-tiers',
            label: 'Quota tiers',
            content: (
              <DataTable columns={columns} data={plan?.quotaTemplates ?? []} empty="No plan quotas yet." />
            )
          },
          {
            id: 'external-events',
            label: 'External events',
            content: (
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void eventForm.handleSubmit()
        }}
      >
        <eventForm.Field name="provider" validators={{ onChange: required }}>
          {(field) => (
            <input
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Provider (e.g. stripe)"
              value={field.state.value}
            />
          )}
        </eventForm.Field>
        <eventForm.Field name="eventType">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as ExternalBillingEventType)}
              value={field.state.value}
            >
              {eventTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </eventForm.Field>
        <eventForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Syncing' : 'Sync external event'}
            </button>
          )}
        </eventForm.Subscribe>
      </form>
            )
          },
          {
            id: 'entitlements',
            label: 'Entitlements',
            content: <EntitlementsTab />
          },
          {
            id: 'lifecycle',
            label: 'Lifecycle',
            content: <LifecycleTab />
          }
        ]}
      />
    </section>
  )
}

const quotaStatusLabels: Record<BillingEntitlementQuotaReport['status'], string> = {
  matched: 'matched',
  missing: 'missing',
  limit_mismatch: 'limit mismatch',
  reset_interval_mismatch: 'reset mismatch',
  limit_and_reset_interval_mismatch: 'limit + reset mismatch'
}

function EntitlementsTab() {
  const queryClient = useQueryClient()
  const entitlementsQuery = useQuery({
    queryKey: ['billingEntitlements'],
    queryFn: getBillingEntitlements
  })
  const reconcileMutation = useMutation({ mutationFn: reconcileBillingEntitlements })

  const columns = useMemo<ColumnDef<BillingEntitlementQuotaReport, any>[]>(
    () => [
      entitlementCol.accessor('metric', {
        header: 'Metric',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      entitlementCol.accessor('status', {
        header: 'Status',
        cell: (c) => <span className="rm-cell-muted">{quotaStatusLabels[c.getValue() as BillingEntitlementQuotaReport['status']]}</span>
      }),
      entitlementCol.accessor('expectedLimit', {
        header: 'Expected limit',
        cell: (c) => <span>{c.getValue()}</span>
      }),
      entitlementCol.accessor((row) => row.actualLimit ?? '—', {
        id: 'actualLimit',
        header: 'Actual limit',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      entitlementCol.accessor('expectedResetInterval', {
        header: 'Expected reset',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      entitlementCol.accessor((row) => row.actualResetInterval ?? '—', {
        id: 'actualReset',
        header: 'Actual reset',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      entitlementCol.accessor((row) => row.actualUsed ?? '—', {
        id: 'actualUsed',
        header: 'Used',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  async function handleReconcile() {
    try {
      const result = await reconcileMutation.mutateAsync()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billingEntitlements'] }),
        queryClient.invalidateQueries({ queryKey: ['billingPlan'] }),
        queryClient.invalidateQueries({ queryKey: ['quotas'] })
      ])
      const { createdQuotaIds, updatedQuotaIds } = result.actions
      toast(
        `Reconciled entitlements (${createdQuotaIds.length} created, ${updatedQuotaIds.length} updated)`,
        'success'
      )
    } catch (caught) {
      toast('Could not reconcile entitlements', 'error')
      throw caught
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Entitlements</div>
        <div className="flex items-center gap-2">
          <button
            className="rm-button"
            disabled={entitlementsQuery.isFetching}
            onClick={() => void entitlementsQuery.refetch()}
            type="button"
          >
            {entitlementsQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            className="rm-button primary"
            disabled={reconcileMutation.isPending}
            onClick={() => void handleReconcile()}
            type="button"
          >
            {reconcileMutation.isPending ? 'Reconciling' : 'Reconcile'}
          </button>
        </div>
      </div>

      <PanelState query={entitlementsQuery} isEmpty={() => false}>
        {(report) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Status', value: report.status === 'healthy' ? 'healthy' : 'attention required' },
                { label: 'Plan configured', value: report.billingPlanConfigured ? 'yes' : 'no' },
                { label: 'Quota templates', value: report.quotaTemplateCount },
                { label: 'Unmanaged quotas', value: report.unmanagedOrgQuotaCount },
                { label: 'Warnings', value: report.warnings.length }
              ]}
            />
            {report.warnings.length ? (
              <div className="text-sm text-muted">Warnings: {report.warnings.join(', ')}</div>
            ) : null}
            <DataTable columns={columns} data={report.quotas} empty="No plan quotas to reconcile." />
          </div>
        )}
      </PanelState>
    </div>
  )
}

function lifecycleActionLabel(action: BillingLifecycleReport['recommendedAction']): string {
  if (action === 'mark_canceled') return 'mark canceled'
  if (action === 'mark_past_due') return 'mark past due'
  return 'none'
}

function LifecycleTab() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const lifecycleQuery = useQuery({ queryKey: ['billingLifecycle'], queryFn: getBillingLifecycle })
  const enforceMutation = useMutation({ mutationFn: enforceBillingLifecycle })

  async function handleEnforce() {
    const confirmed = await ask({
      title: 'Enforce lifecycle?',
      body: 'This may change the account status (e.g. mark it canceled or past due) based on the current lifecycle report.',
      confirmLabel: 'Enforce lifecycle',
      tone: 'danger'
    })
    if (!confirmed) return
    try {
      const result = await enforceMutation.mutateAsync()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billingLifecycle'] }),
        queryClient.invalidateQueries({ queryKey: ['billingPlan'] }),
        queryClient.invalidateQueries({ queryKey: ['billingEntitlements'] })
      ])
      if (result.action.statusChanged) {
        toast(`Lifecycle enforced: ${result.action.previousStatus} → ${result.action.newStatus}`, 'success')
      } else {
        toast('Lifecycle enforced (no status change)', 'success')
      }
    } catch (caught) {
      toast('Could not enforce lifecycle', 'error')
      throw caught
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Lifecycle</div>
        <div className="flex items-center gap-2">
          <button
            className="rm-button"
            disabled={lifecycleQuery.isFetching}
            onClick={() => void lifecycleQuery.refetch()}
            type="button"
          >
            {lifecycleQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            className="rm-button primary"
            disabled={enforceMutation.isPending}
            onClick={() => void handleEnforce()}
            type="button"
          >
            {enforceMutation.isPending ? 'Enforcing' : 'Enforce lifecycle'}
          </button>
        </div>
      </div>

      <PanelState query={lifecycleQuery} isEmpty={() => false}>
        {(report) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Status', value: report.status === 'healthy' ? 'healthy' : 'attention required' },
                { label: 'Plan configured', value: report.billingPlanConfigured ? 'yes' : 'no' },
                { label: 'Recommended action', value: lifecycleActionLabel(report.recommendedAction) },
                { label: 'Warnings', value: report.warnings.length }
              ]}
            />
            {report.warnings.length ? (
              <div className="text-sm text-muted">Warnings: {report.warnings.join(', ')}</div>
            ) : null}
            {report.billingPlan ? (
              <div className="text-sm text-muted">
                Plan: <span className="font-medium">{report.billingPlan.name}</span> ({report.billingPlan.code}) —{' '}
                {report.billingPlan.status} / {report.billingPlan.source}
              </div>
            ) : null}
          </div>
        )}
      </PanelState>
      {dialog}
    </div>
  )
}
