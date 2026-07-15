import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { createDeviceAuthorization, listDeviceAuthorizations, revokeDeviceAuthorization } from '../api/device-client'
import type { CreatedDeviceAuthorization, DeviceAuthorization } from '../api/device-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'

const col = createColumnHelper<DeviceAuthorization>()

const scopeOptions = ['me:read', 'tools:use', 'tools:manage', 'audit:read', 'webhooks:read', 'webhooks:write']

function authorizationStatus(authorization: DeviceAuthorization): 'active' | 'expired' | 'revoked' {
  if (authorization.revokedAt !== undefined) return 'revoked'
  if (new Date(authorization.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'active'
}

export function DeviceTokensPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const [created, setCreated] = useState<CreatedDeviceAuthorization>()
  const tokensQuery = useQuery({ queryKey: ['deviceAuthorizations'], queryFn: listDeviceAuthorizations })
  const createMutation = useMutation({ mutationFn: createDeviceAuthorization })
  const revokeMutation = useMutation({ mutationFn: revokeDeviceAuthorization })

  const tokenForm = useForm({
    defaultValues: { name: '', scopes: ['me:read'] as string[], ttlDays: 90 },
    onSubmit: async ({ value }) => {
      try {
        const result = await createMutation.mutateAsync({
          name: value.name,
          scopes: value.scopes,
          ttlDays: value.ttlDays
        })
        setCreated(result)
        await queryClient.invalidateQueries({ queryKey: ['deviceAuthorizations'] })
        toast('Device token created', 'success')
        setAddOpen(false)
        tokenForm.reset()
      } catch {
        toast('Could not create device token', 'error')
      }
    }
  })

  async function handleRevoke(deviceAuthorizationId: string) {
    if (
      !(await ask({
        title: 'Revoke device token?',
        body: 'Anything using this token stops working immediately.',
        confirmLabel: 'Revoke',
        tone: 'danger'
      }))
    )
      return
    try {
      await revokeMutation.mutateAsync(deviceAuthorizationId)
      await queryClient.invalidateQueries({ queryKey: ['deviceAuthorizations'] })
      toast('Device token revoked', 'success')
    } catch {
      toast('Could not revoke device token', 'error')
    }
  }

  const columns = useMemo<ColumnDef<DeviceAuthorization, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      col.accessor((row) => row.scopes.join(', '), {
        id: 'scopes',
        header: 'Scopes',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      col.accessor('createdAt', {
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleDateString()}</span>
      }),
      col.accessor((row) => row.expiresAt, {
        id: 'expires',
        header: 'Expires',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleDateString()}</span>
      }),
      col.accessor((row) => authorizationStatus(row), {
        id: 'status',
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'active' ? 'pass' : 'fail'}`}>{c.getValue()}</span>
        )
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className="rm-button"
            disabled={c.row.original.revokedAt !== undefined || revokeMutation.isPending}
            onClick={() => void handleRevoke(c.row.original.id)}
            type="button"
          >
            {c.row.original.revokedAt ? 'Revoked' : 'Revoke'}
          </button>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending]
  )

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">Device tokens</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Add device token
        </button>
      </div>

      {created ? (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-2 text-sm">
          <div className="text-muted">Store these now — they are shown only once.</div>
          <div>
            <div className="text-muted">Access token</div>
            <div className="break-all font-mono">{created.accessToken}</div>
          </div>
          <div>
            <div className="text-muted">Refresh token</div>
            <div className="break-all font-mono">{created.refreshToken}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <PanelState
          query={tokensQuery}
          empty="No device tokens yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add device token
            </button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total tokens', value: rows.length },
                  {
                    label: 'Revoked/expired',
                    value: rows.filter((r) => authorizationStatus(r) !== 'active').length,
                  },
                ]}
              />
              <DataTable columns={columns} data={rows} empty="No device tokens yet." />
            </div>
          )}
        </PanelState>
      </div>

      <FormDialog open={addOpen} title="New device token" onClose={() => setAddOpen(false)}>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void tokenForm.handleSubmit()
          }}
        >
        <label className="text-sm text-muted" htmlFor="device-token-name">
          Token name
        </label>
        <tokenForm.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="device-token-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="CLI device"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </tokenForm.Field>
        <label className="text-sm text-muted" htmlFor="device-token-ttl">
          Expires in (days)
        </label>
        <tokenForm.Field name="ttlDays">
          {(field) => (
            <input
              className="rm-input"
              id="device-token-ttl"
              min={1}
              max={365}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(Number(event.currentTarget.value))}
              type="number"
              value={field.state.value}
            />
          )}
        </tokenForm.Field>
        <tokenForm.Field name="scopes">
          {(field) => (
            <div className="grid gap-2 text-sm">
              {scopeOptions.map((scope) => (
                <label className="flex items-center gap-2" key={scope}>
                  <input
                    checked={field.state.value.includes(scope)}
                    onChange={() => {
                      const current = field.state.value
                      field.handleChange(
                        current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]
                      )
                    }}
                    type="checkbox"
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          )}
        </tokenForm.Field>
        <tokenForm.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, scopes: state.values.scopes })}
        >
          {({ canSubmit, isSubmitting, scopes }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting || scopes.length === 0} type="submit">
              {isSubmitting ? 'Creating' : 'Create device token'}
            </button>
          )}
        </tokenForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </section>
  )
}
