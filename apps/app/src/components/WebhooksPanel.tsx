import { useForm } from '@tanstack/react-form'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import {
  bulkDisableWebhooks,
  createWebhook,
  disableWebhook,
  listWebhookDeliveriesPage,
  listWebhooks,
  testWebhook
} from '../api/webhooks-client'
import { type WebhookDelivery, type WebhookEventType, type WebhookSubscription, webhookEventTypes } from '../api/webhooks-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { Drawer } from './Drawer'
import { FormDialog } from './FormDialog'
import { OverflowMenu } from './OverflowMenu'
import { PanelStats } from './PanelStats'
import { useWorkspace } from './WorkspaceContext'

const DELIVERIES_PAGE_SIZE = 25

const webhookCol = createColumnHelper<WebhookSubscription>()
const deliveryCol = createColumnHelper<WebhookDelivery>()

export function WebhooksPanel() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspace()
  const { ask, dialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookSubscription | undefined>(undefined)
  const selectedWebhookId = selectedWebhook?.id
  // Cursor stack for the deliveries pager: index 0 is the first page (undefined
  // cursor); each push is the nextCursor that opened the following page.
  const [deliveryCursors, setDeliveryCursors] = useState<Array<string | undefined>>([undefined])
  const deliveryCursor = deliveryCursors[deliveryCursors.length - 1]

  const webhooksQuery = useQuery({ queryKey: ['webhooks', workspaceId], queryFn: () => listWebhooks(workspaceId) })
  const deliveriesQuery = useQuery({
    queryKey: ['webhookDeliveries', selectedWebhookId, deliveryCursor],
    queryFn: () =>
      listWebhookDeliveriesPage({
        webhookId: selectedWebhookId!,
        limit: DELIVERIES_PAGE_SIZE,
        ...(deliveryCursor !== undefined ? { cursor: deliveryCursor } : {})
      }),
    enabled: selectedWebhookId !== undefined,
    placeholderData: keepPreviousData
  })

  const createMutation = useMutation({ mutationFn: createWebhook })
  const disableMutation = useMutation({ mutationFn: disableWebhook })
  const bulkDisableMutation = useMutation({ mutationFn: bulkDisableWebhooks })
  const testMutation = useMutation({ mutationFn: testWebhook })

  function openDeliveries(webhook: WebhookSubscription) {
    setSelectedWebhook(webhook)
    setDeliveryCursors([undefined])
  }

  const createForm = useForm({
    defaultValues: {
      url: '',
      eventTypes: ['webhook.test'] as WebhookEventType[]
    },
    onSubmit: async ({ value }) => {
      try {
        await createMutation.mutateAsync({ url: value.url, eventTypes: value.eventTypes })
        await queryClient.invalidateQueries({ queryKey: ['webhooks', workspaceId] })
        toast('Webhook created', 'success')
        createForm.reset()
        setAddOpen(false)
      } catch (caught) {
        toast('Could not create webhook', 'error')
        throw caught
      }
    }
  })

  async function handleDisable(webhookId: string) {
    if (!(await ask({ title: 'Disable webhook?', confirmLabel: 'Disable', tone: 'danger' }))) return
    try {
      await disableMutation.mutateAsync(webhookId)
      await queryClient.invalidateQueries({ queryKey: ['webhooks', workspaceId] })
      toast('Webhook disabled', 'success')
    } catch {
      toast('Could not disable webhook', 'error')
    }
  }

  async function handleTest(webhookId: string) {
    try {
      await testMutation.mutateAsync(webhookId)
      await queryClient.invalidateQueries({ queryKey: ['webhookDeliveries', webhookId] })
      toast('Test event sent', 'success')
    } catch {
      toast('Could not send test event', 'error')
    }
  }

  async function handleBulkDisable(webhookIds: string[], clearSelection: () => void) {
    if (
      !(await ask({
        title: `Disable ${webhookIds.length} webhook${webhookIds.length === 1 ? '' : 's'}?`,
        confirmLabel: 'Disable',
        tone: 'danger'
      }))
    )
      return
    try {
      const results = await bulkDisableMutation.mutateAsync(webhookIds)
      await queryClient.invalidateQueries({ queryKey: ['webhooks', workspaceId] })
      clearSelection()
      const disabled = results.filter((result) => result.status === 'disabled').length
      toast(`Disabled ${disabled} webhook${disabled === 1 ? '' : 's'}`, 'success')
    } catch {
      toast('Could not disable webhooks', 'error')
    }
  }

  const webhookColumns = useMemo<ColumnDef<WebhookSubscription, any>[]>(
    () => [
      webhookCol.accessor('url', {
        header: 'URL',
        cell: (c) => <span className="rm-mono font-medium">{c.getValue()}</span>
      }),
      webhookCol.accessor((row) => row.eventTypes.join(', '), {
        id: 'eventTypes',
        header: 'Events',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      webhookCol.accessor((row) => (row.disabledAt ? 'disabled' : 'active'), {
        id: 'status',
        header: 'Status',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      webhookCol.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const webhook = c.row.original
          return (
            <div className="flex justify-end">
              <OverflowMenu
                items={[
                  { label: 'Test', onClick: () => void handleTest(webhook.id), disabled: testMutation.isPending },
                  { label: 'View deliveries', onClick: () => openDeliveries(webhook) },
                  ...(webhook.disabledAt
                    ? []
                    : [
                        {
                          label: 'Disable',
                          onClick: () => void handleDisable(webhook.id),
                          tone: 'danger' as const,
                          disabled: disableMutation.isPending
                        }
                      ])
                ]}
              />
            </div>
          )
        }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending, testMutation.isPending]
  )

  const deliveryColumns = useMemo<ColumnDef<WebhookDelivery, any>[]>(
    () => [
      deliveryCol.accessor('eventType', {
        header: 'Event',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      deliveryCol.accessor('status', {
        header: 'Status',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      deliveryCol.accessor('attemptCount', {
        header: 'Attempts',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      deliveryCol.accessor((row) => new Date(row.createdAt).toLocaleString(), {
        id: 'createdAt',
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Webhooks</div>
        <div className="flex gap-2">
          <button className="rm-button" disabled={webhooksQuery.isFetching} onClick={() => void webhooksQuery.refetch()} type="button">
            {webhooksQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
            + Add webhook
          </button>
        </div>
      </div>

      <FormDialog open={addOpen} title="New webhook" onClose={() => setAddOpen(false)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void createForm.handleSubmit()
        }}
      >
        <createForm.Field
          name="url"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'URL is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="https://example.com/webhook"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </createForm.Field>
        <createForm.Field
          name="eventTypes"
          validators={{ onChange: ({ value }: { value: WebhookEventType[] }) => (value.length === 0 ? 'Select at least one event' : undefined) }}
        >
          {(field) => (
            <>
              <div className="grid gap-1">
                {webhookEventTypes.map((eventType) => {
                  const checked = field.state.value.includes(eventType)
                  return (
                    <label className="flex items-center gap-2 text-sm" key={eventType}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, eventType]
                            : field.state.value.filter((value) => value !== eventType)
                          field.handleChange(next)
                        }}
                        type="checkbox"
                      />
                      <span className="rm-mono">{eventType}</span>
                    </label>
                  )
                })}
              </div>
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </createForm.Field>
        <createForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Creating' : 'Create webhook'}
            </button>
          )}
        </createForm.Subscribe>
      </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          empty="No webhooks yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add webhook
            </button>
          }
          query={webhooksQuery}
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total webhooks', value: rows.length },
                  { label: 'Disabled', value: rows.filter((row) => row.disabledAt).length }
                ]}
              />
              <DataTable
                bulkActions={(ids, clear) => (
                  <button
                    className="rm-button"
                    disabled={bulkDisableMutation.isPending}
                    onClick={() => void handleBulkDisable(ids, clear)}
                    type="button"
                  >
                    Disable {ids.length}
                  </button>
                )}
                columns={webhookColumns}
                data={rows}
                enableRowSelection
                getRowId={(row) => row.id}
              />
            </div>
          )}
        </PanelState>
      </div>

      <Drawer
        description="Recent delivery attempts for this webhook."
        onClose={() => setSelectedWebhook(undefined)}
        open={selectedWebhook !== undefined}
        title={selectedWebhook?.url ?? 'Deliveries'}
      >
        <PanelState
          empty="No deliveries for this webhook."
          isEmpty={(page) => page.data.length === 0 && deliveryCursors.length === 1}
          query={deliveriesQuery}
        >
          {(page) => (
            <DataTable
              columns={deliveryColumns}
              data={page.data}
              serverPagination={{
                pageSize: DELIVERIES_PAGE_SIZE,
                hasNextPage: page.nextCursor !== undefined,
                isFetching: deliveriesQuery.isFetching,
                onNextPage: () => {
                  if (page.nextCursor !== undefined) setDeliveryCursors((stack) => [...stack, page.nextCursor])
                },
                ...(deliveryCursors.length > 1
                  ? { onPrevPage: () => setDeliveryCursors((stack) => stack.slice(0, -1)) }
                  : {})
              }}
            />
          )}
        </PanelState>
      </Drawer>
      {dialog}
    </section>
  )
}
