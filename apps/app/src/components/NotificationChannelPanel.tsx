import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import {
  createNotificationChannel,
  getNotificationPolicy,
  listNotificationChannels,
  listNotificationDeliveries,
  updateNotificationPolicy
} from '../api/notification-channel-client'
import type {
  CreateNotificationChannelInput,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  NotificationPolicyReport,
  NotificationType,
  UpdateNotificationPolicyRequest
} from '../api/notification-channel-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

const channelCol = createColumnHelper<NotificationDeliveryChannel>()
const deliveryCol = createColumnHelper<NotificationDelivery>()

const channelTypes = ['email', 'slack', 'webhook'] as const
type UiNotificationChannelType = (typeof channelTypes)[number]

/** Enum-driven suppression options (tolerant of future additions). */
const notificationTypes: { value: NotificationType; label: string }[] = [
  { value: 'chat_mention', label: 'Chat mention' }
]

const required = ({ value }: { value: string }) => (!value?.trim() ? 'Required' : undefined)

/** textarea (one-per-line) <-> string[] helpers. Server trims/normalizes. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function arrayToLines(values: string[]): string {
  return values.join('\n')
}

export function NotificationChannelPanel() {
  return (
    <section className="rm-panel p-4">
      <Tabs
        tabs={[
          { id: 'channels', label: 'Channels', content: <ChannelsTab /> },
          { id: 'policy', label: 'Policy', content: <NotificationPolicyForm /> }
        ]}
      />
    </section>
  )
}

function ChannelsTab() {
  const queryClient = useQueryClient()
  const channelsQuery = useQuery({ queryKey: ['notificationChannels'], queryFn: listNotificationChannels })
  const deliveriesQuery = useQuery({ queryKey: ['notificationDeliveries'], queryFn: listNotificationDeliveries })
  const createMutation = useMutation({ mutationFn: createNotificationChannel })
  const [addOpen, setAddOpen] = useState(false)

  const form = useForm({
    defaultValues: {
      type: 'email' as NotificationDeliveryChannelType,
      name: '',
      target: ''
    },
    onSubmit: async ({ value }) => {
      try {
        const input: CreateNotificationChannelInput =
          value.type === 'email'
            ? { type: 'email', name: value.name, config: { to: value.target } }
            : value.type === 'slack'
              ? { type: 'slack', name: value.name, config: { url: value.target } }
              : { type: 'webhook', name: value.name, config: { url: value.target } }
        await createMutation.mutateAsync(input)
        await queryClient.invalidateQueries({ queryKey: ['notificationChannels'] })
        toast('Channel created', 'success')
        setAddOpen(false)
      } catch (caught) {
        toast('Could not create channel', 'error')
        throw caught
      }
    }
  })

  const channelColumns = useMemo<ColumnDef<NotificationDeliveryChannel, any>[]>(
    () => [
      channelCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      channelCol.accessor('type', {
        header: 'Type',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      channelCol.accessor((row) => (row.enabled ? 'enabled' : 'disabled'), {
        id: 'enabled',
        header: 'State',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      channelCol.accessor('createdAt', {
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
      })
    ],
    []
  )

  const deliveryColumns = useMemo<ColumnDef<NotificationDelivery, any>[]>(
    () => [
      deliveryCol.accessor('notificationId', {
        header: 'Notification',
        cell: (c) => <span className="rm-mono rm-cell-muted">{c.getValue()}</span>
      }),
      deliveryCol.accessor('channelId', {
        header: 'Channel',
        cell: (c) => <span className="rm-mono rm-cell-muted">{c.getValue()}</span>
      }),
      deliveryCol.accessor('status', {
        header: 'Status',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      deliveryCol.accessor('attemptCount', {
        header: 'Attempts',
        cell: (c) => <span>{c.getValue()}</span>
      }),
      deliveryCol.accessor((row) => row.errorCode ?? '', {
        id: 'error',
        header: 'Error',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Notification channels</div>
        <div className="flex items-center gap-2">
          <button
            className="rm-button"
            disabled={channelsQuery.isFetching}
            onClick={() => void channelsQuery.refetch()}
            type="button"
          >
            {channelsQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
            + Add channel
          </button>
        </div>
      </div>

      <FormDialog open={addOpen} title="New channel" onClose={() => setAddOpen(false)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="type">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as UiNotificationChannelType)}
              value={field.state.value}
            >
              {channelTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Field name="name" validators={{ onChange: required }}>
          {(field) => (
            <>
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Channel name"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.type}>
          {(type) => (
            <form.Field name="target" validators={{ onChange: required }}>
              {(field) => (
                <>
                  <input
                    className="rm-input"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    placeholder={type === 'email' ? 'to@example.com' : 'https://…'}
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length ? (
                    <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                  ) : null}
                </>
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Creating' : 'Create channel'}
            </button>
          )}
        </form.Subscribe>
      </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          query={channelsQuery}
          empty="No channels yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add channel
            </button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total channels', value: rows.length },
                  { label: 'Enabled', value: rows.filter((row) => row.enabled).length }
                ]}
              />
              <DataTable columns={channelColumns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>

      <div className="rm-card-header mt-4">
        <div className="rm-card-title">Deliveries</div>
        <button
          className="rm-button"
          disabled={deliveriesQuery.isFetching}
          onClick={() => void deliveriesQuery.refetch()}
          type="button"
        >
          {deliveriesQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-2">
        <DataTable columns={deliveryColumns} data={deliveriesQuery.data ?? []} empty="No deliveries yet." />
      </div>
    </div>
  )
}

function NotificationPolicyForm() {
  const queryClient = useQueryClient()
  const policyQuery = useQuery({ queryKey: ['notificationPolicy'], queryFn: getNotificationPolicy })

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Delivery policy</div>
        <button
          className="rm-button"
          disabled={policyQuery.isFetching}
          onClick={() => void policyQuery.refetch()}
          type="button"
        >
          {policyQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={policyQuery} empty="No policy loaded.">
        {(report) => <PolicyEditor report={report} queryClient={queryClient} />}
      </PanelState>
    </div>
  )
}

function PolicyEditor(props: {
  report: NotificationPolicyReport
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const { report, queryClient } = props
  const updateMutation = useMutation({ mutationFn: updateNotificationPolicy })

  const form = useForm({
    defaultValues: {
      deliveryEnabled: report.policy.deliveryEnabled,
      allowedChannelTypes: report.policy.allowedChannelTypes,
      allowedWebhookHosts: arrayToLines(report.policy.allowedWebhookHosts),
      allowedSlackHosts: arrayToLines(report.policy.allowedSlackHosts),
      allowedEmailDomains: arrayToLines(report.policy.allowedEmailDomains),
      suppressedNotificationTypes: report.policy.suppressedNotificationTypes
    },
    onSubmit: async ({ value }) => {
      try {
        const input: UpdateNotificationPolicyRequest = {
          deliveryEnabled: value.deliveryEnabled,
          allowedChannelTypes: value.allowedChannelTypes,
          allowedWebhookHosts: linesToArray(value.allowedWebhookHosts),
          allowedSlackHosts: linesToArray(value.allowedSlackHosts),
          allowedEmailDomains: linesToArray(value.allowedEmailDomains),
          suppressedNotificationTypes: value.suppressedNotificationTypes
        }
        await updateMutation.mutateAsync(input)
        // Server normalizes (dedupe/sort/drop) — re-render from the fresh report.
        await queryClient.invalidateQueries({ queryKey: ['notificationPolicy'] })
        toast('Policy updated', 'success')
      } catch (caught) {
        toast('Could not update policy', 'error')
        throw caught
      }
    }
  })

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Delivery', value: report.posture.deliveryEnabled ? 'enabled' : 'disabled' },
          {
            label: 'Channel types',
            value: report.posture.channelTypeRestrictionActive ? 'restricted' : 'all'
          },
          {
            label: 'Host allowlists',
            value:
              (report.posture.webhookHostRestrictionActive ? 1 : 0) +
              (report.posture.slackHostRestrictionActive ? 1 : 0)
          },
          {
            label: 'Email restriction',
            value: report.posture.emailDomainRestrictionActive ? 'on' : 'off'
          },
          { label: 'Suppressed types', value: report.posture.suppressedNotificationTypeCount }
        ]}
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="deliveryEnabled">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Delivery enabled (master switch)</span>
            </label>
          )}
        </form.Field>

        <form.Field name="allowedChannelTypes">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">Allowed channel types</div>
              <div className="flex flex-wrap gap-3">
                {channelTypes.map((type) => {
                  const checked = field.state.value.includes(type)
                  return (
                    <label className="flex items-center gap-2 text-sm" key={type}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, type]
                            : field.state.value.filter((value) => value !== type)
                          field.handleChange(next)
                        }}
                        type="checkbox"
                      />
                      <span>{type}</span>
                    </label>
                  )
                })}
              </div>
              <div className="text-xs text-muted">Empty = no channels allowed.</div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedWebhookHosts">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="policy-webhook-hosts">
                Allowed webhook hosts (one per line)
              </label>
              <textarea
                className="rm-input"
                id="policy-webhook-hosts"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'hooks.example.com\n*.internal.example.com'}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">Empty = no host restriction. Wildcards like *.example.com allowed.</div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedSlackHosts">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="policy-slack-hosts">
                Allowed Slack hosts (one per line)
              </label>
              <textarea
                className="rm-input"
                id="policy-slack-hosts"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'hooks.slack.com'}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">Empty = no host restriction. Wildcards like *.slack.com allowed.</div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedEmailDomains">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="policy-email-domains">
                Allowed email domains (one per line)
              </label>
              <textarea
                className="rm-input"
                id="policy-email-domains"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'example.com'}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">Empty = no restriction. No @, /, : or leading/trailing dots.</div>
            </div>
          )}
        </form.Field>

        <form.Field name="suppressedNotificationTypes">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">Suppressed notification types</div>
              <div className="flex flex-wrap gap-3">
                {notificationTypes.map((option) => {
                  const checked = field.state.value.includes(option.value)
                  return (
                    <label className="flex items-center gap-2 text-sm" key={option.value}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, option.value]
                            : field.state.value.filter((value) => value !== option.value)
                          field.handleChange(next)
                        }}
                        type="checkbox"
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <button className="rm-button primary" disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? 'Saving' : 'Save policy'}
              </button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  Updated {new Date(report.updatedAt).toLocaleString()}
                  {report.updatedBy ? ` by ${report.updatedBy}` : ''}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}
