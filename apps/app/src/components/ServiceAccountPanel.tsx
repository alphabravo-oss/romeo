import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { bulkDisableServiceAccounts, createServiceAccount, createServiceAccountApiKey, disableServiceAccount, listServiceAccounts } from '../api/client'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import type { ServiceAccount } from '../api/admin-types'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { OverflowMenu } from './OverflowMenu'
import { PanelStats } from './PanelStats'

const serviceAccountScopes = ['me:read', 'tools:use', 'knowledge:query', 'runs:create', 'webhooks:read', 'webhooks:write']

const col = createColumnHelper<ServiceAccount>()

export function ServiceAccountPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<string>()
  const accountsQuery = useQuery({ queryKey: ['serviceAccounts'], queryFn: listServiceAccounts })
  const createMutation = useMutation({ mutationFn: createServiceAccount })
  const keyMutation = useMutation({ mutationFn: createServiceAccountApiKey })
  const disableMutation = useMutation({ mutationFn: disableServiceAccount })
  const bulkDisableMutation = useMutation({ mutationFn: bulkDisableServiceAccounts })

  const ServiceAccountForm = useForm({
    defaultValues: {
      name: '',
      keyName: '',
      scopes: ['me:read', 'tools:use'] as string[],
    },
    onSubmit: async ({ value }) => {
      try {
        const account = await createMutation.mutateAsync({ name: value.name, scopes: value.scopes })
        const key = await keyMutation.mutateAsync({ serviceAccountId: account.id, name: value.keyName, scopes: value.scopes })
        setCreatedToken(key.token)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['serviceAccounts'] }),
          queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
        ])
        toast('Service account created', 'success')
        setAddOpen(false)
        ServiceAccountForm.reset()
      } catch {
        toast('Could not create service account', 'error')
      }
    },
  })

  async function handleCreateKey(account: ServiceAccount) {
    try {
      const key = await keyMutation.mutateAsync({
        serviceAccountId: account.id,
        name: `${account.name} key`,
        scopes: account.scopes,
      })
      setCreatedToken(key.token)
      await queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      toast('API key created', 'success')
    } catch {
      toast('Could not create API key', 'error')
    }
  }

  async function handleDisable(serviceAccountId: string) {
    if (!(await ask({ title: 'Disable service account?', body: 'It loses access immediately.', confirmLabel: 'Disable', tone: 'danger' }))) return
    try {
      await disableMutation.mutateAsync(serviceAccountId)
      await queryClient.invalidateQueries({ queryKey: ['serviceAccounts'] })
      toast('Service account disabled', 'success')
    } catch {
      toast('Could not disable service account', 'error')
    }
  }

  async function handleBulkDisable(serviceAccountIds: string[], clearSelection: () => void) {
    if (serviceAccountIds.length === 0) return
    if (
      !(await ask({
        title: `Disable ${serviceAccountIds.length} service account${serviceAccountIds.length === 1 ? '' : 's'}?`,
        body: 'They lose access immediately.',
        confirmLabel: 'Disable',
        tone: 'danger',
      }))
    )
      return
    try {
      const result = await bulkDisableMutation.mutateAsync(serviceAccountIds)
      await queryClient.invalidateQueries({ queryKey: ['serviceAccounts'] })
      clearSelection()
      const failed = result.results.filter((item) => item.status === 'failure').length
      if (failed > 0) {
        toast(`Disabled ${result.results.length - failed}, ${failed} failed`, 'error')
      } else {
        toast(`Disabled ${result.results.length} service account${result.results.length === 1 ? '' : 's'}`, 'success')
      }
    } catch {
      toast('Could not disable service accounts', 'error')
    }
  }

  const columns = useMemo<ColumnDef<ServiceAccount, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor((row) => row.scopes.join(', '), {
        id: 'scopes',
        header: 'Scopes',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
      }),
      col.accessor((row) => (row.disabledAt ? 'disabled' : 'active'), {
        id: 'status',
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'active' ? 'pass' : 'fail'}`}>
            {c.getValue()}
          </span>
        ),
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <OverflowMenu
            items={[
              {
                label: 'Create key',
                disabled: keyMutation.isPending || c.row.original.disabledAt !== undefined,
                onClick: () => void handleCreateKey(c.row.original),
              },
              {
                label: 'Disable',
                tone: 'danger',
                disabled: disableMutation.isPending || c.row.original.disabledAt !== undefined,
                onClick: () => void handleDisable(c.row.original.id),
              },
            ]}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending, keyMutation.isPending],
  )

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">Service accounts</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Add service account
        </button>
      </div>
      {createdToken ? (
        <div className="mt-3 rounded-md border border-border p-2 text-sm">
          <div className="text-muted">Token</div>
          <div className="break-all font-mono">{createdToken}</div>
        </div>
      ) : null}
      <div className="mt-4">
        <PanelState
          query={accountsQuery}
          empty="No service accounts yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add service account
            </button>
          }
        >
          {(accounts) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total accounts', value: accounts.length },
                  { label: 'Disabled', value: accounts.filter((a) => a.disabledAt).length },
                ]}
              />
              <DataTable
                columns={columns}
                data={accounts}
                empty="No service accounts yet."
                enableRowSelection
                getRowId={(row) => row.id}
                bulkActions={(ids, clear) => (
                  <button
                    className="rm-button danger"
                    disabled={bulkDisableMutation.isPending}
                    onClick={() => void handleBulkDisable(ids, clear)}
                    type="button"
                  >
                    {bulkDisableMutation.isPending ? 'Disabling' : `Disable ${ids.length}`}
                  </button>
                )}
              />
            </div>
          )}
        </PanelState>
      </div>
      <FormDialog open={addOpen} title="New service account" onClose={() => setAddOpen(false)}>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void ServiceAccountForm.handleSubmit()
          }}
        >
        <label className="text-sm text-muted" htmlFor="service-account-name">Name</label>
        <ServiceAccountForm.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="service-account-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Tool worker"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </ServiceAccountForm.Field>
        <label className="text-sm text-muted" htmlFor="service-account-key-name">Key name</label>
        <ServiceAccountForm.Field name="keyName">
          {(field) => (
            <input
              className="rm-input"
              id="service-account-key-name"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Tool worker key"
              value={field.state.value}
            />
          )}
        </ServiceAccountForm.Field>
        <ServiceAccountForm.Field name="scopes">
          {(field) => (
            <div className="grid gap-2 text-sm">
              {serviceAccountScopes.map((scope) => (
                <label className="flex items-center gap-2" key={scope}>
                  <input
                    checked={field.state.value.includes(scope)}
                    onChange={() => {
                      const current = field.state.value
                      field.handleChange(
                        current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
                      )
                    }}
                    type="checkbox"
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          )}
        </ServiceAccountForm.Field>
        <ServiceAccountForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, scopes: state.values.scopes })}>
          {({ canSubmit, isSubmitting, scopes }) => (
            <button
              className="rm-button"
              disabled={!canSubmit || isSubmitting || scopes.length === 0 || createMutation.isPending || keyMutation.isPending}
              type="submit"
            >
              {isSubmitting || createMutation.isPending || keyMutation.isPending ? 'Creating' : 'Create service account'}
            </button>
          )}
        </ServiceAccountForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </section>
  )
}
