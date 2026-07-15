import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { bulkRevokeApiKeys, createApiKey, listApiKeys, revokeApiKey } from '../api/client'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import type { ApiKeySummary } from '../api/admin-types'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { Drawer } from './Drawer'
import { FormDialog } from './FormDialog'
import { OverflowMenu } from './OverflowMenu'
import { PanelStats } from './PanelStats'

const col = createColumnHelper<ApiKeySummary>()

const scopeOptions = ['me:read', 'tools:use', 'tools:manage', 'audit:read', 'webhooks:read', 'webhooks:write']

export function ApiKeyPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<string>()
  const [detailKey, setDetailKey] = useState<ApiKeySummary>()
  const apiKeysQuery = useQuery({ queryKey: ['apiKeys'], queryFn: listApiKeys })
  const createMutation = useMutation({ mutationFn: createApiKey })
  const revokeMutation = useMutation({ mutationFn: revokeApiKey })
  const bulkRevokeMutation = useMutation({ mutationFn: bulkRevokeApiKeys })

  const ApiKeyForm = useForm({
    defaultValues: { name: '', scopes: ['me:read'] as string[] },
    onSubmit: async ({ value }) => {
      try {
        const created = await createMutation.mutateAsync({ name: value.name, scopes: value.scopes })
        setCreatedToken(created.token)
        await queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
        toast('API key created', 'success')
        setAddOpen(false)
        ApiKeyForm.reset()
      } catch {
        toast('Could not create API key', 'error')
      }
    },
  })

  async function handleRevoke(apiKeyId: string) {
    if (!(await ask({ title: 'Revoke API key?', body: 'Anything using this key stops working immediately.', confirmLabel: 'Revoke', tone: 'danger' }))) return
    try {
      await revokeMutation.mutateAsync(apiKeyId)
      await queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setDetailKey((current) => (current?.id === apiKeyId ? undefined : current))
      toast('API key revoked', 'success')
    } catch {
      toast('Could not revoke API key', 'error')
    }
  }

  async function handleBulkRevoke(apiKeyIds: string[], clearSelection: () => void) {
    if (apiKeyIds.length === 0) return
    if (
      !(await ask({
        title: `Revoke ${apiKeyIds.length} API key${apiKeyIds.length === 1 ? '' : 's'}?`,
        body: 'Anything using these keys stops working immediately.',
        confirmLabel: 'Revoke',
        tone: 'danger',
      }))
    )
      return
    try {
      const result = await bulkRevokeMutation.mutateAsync(apiKeyIds)
      await queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      clearSelection()
      const failed = result.results.filter((item) => item.status === 'failure').length
      if (failed > 0) {
        toast(`Revoked ${result.results.length - failed}, ${failed} failed`, 'error')
      } else {
        toast(`Revoked ${result.results.length} API key${result.results.length === 1 ? '' : 's'}`, 'success')
      }
    } catch {
      toast('Could not revoke API keys', 'error')
    }
  }

  const columns = useMemo<ColumnDef<ApiKeySummary, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Name',
        cell: (c) => (
          <button
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => setDetailKey(c.row.original)}
            type="button"
          >
            {c.getValue()}
          </button>
        ),
      }),
      col.accessor((row) => row.scopes.join(', '), {
        id: 'scopes',
        header: 'Scopes',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
      }),
      col.accessor('createdAt', {
        header: 'Created',
        cell: (c) => (
          <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleDateString()}</span>
        ),
      }),
      col.accessor((row) => (row.revokedAt ? 'revoked' : 'active'), {
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
              { label: 'Details', onClick: () => setDetailKey(c.row.original) },
              {
                label: 'Revoke',
                tone: 'danger',
                disabled: c.row.original.revokedAt !== undefined || revokeMutation.isPending,
                onClick: () => void handleRevoke(c.row.original.id),
              },
            ]}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending],
  )

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">API keys</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Add API key
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
          query={apiKeysQuery}
          empty="No API keys yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add API key
            </button>
          }
        >
          {(apiKeys) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total keys', value: apiKeys.length },
                  { label: 'Revoked', value: apiKeys.filter((k) => k.revokedAt).length },
                ]}
              />
              <DataTable
                columns={columns}
                data={apiKeys}
                empty="No API keys yet."
                enableRowSelection
                getRowId={(row) => row.id}
                bulkActions={(ids, clear) => (
                  <button
                    className="rm-button danger"
                    disabled={bulkRevokeMutation.isPending}
                    onClick={() => void handleBulkRevoke(ids, clear)}
                    type="button"
                  >
                    {bulkRevokeMutation.isPending ? 'Revoking' : `Revoke ${ids.length}`}
                  </button>
                )}
              />
            </div>
          )}
        </PanelState>
      </div>

      <FormDialog open={addOpen} title="New API key" onClose={() => setAddOpen(false)}>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void ApiKeyForm.handleSubmit()
          }}
        >
        <label className="text-sm text-muted" htmlFor="api-key-name">
          API key name
        </label>
        <ApiKeyForm.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="api-key-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Production integration"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </ApiKeyForm.Field>
        <ApiKeyForm.Field name="scopes">
          {(field) => (
            <div className="grid gap-2 text-sm">
              {scopeOptions.map((scope) => (
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
        </ApiKeyForm.Field>
        <ApiKeyForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, scopes: state.values.scopes })}>
          {({ canSubmit, isSubmitting, scopes }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting || scopes.length === 0} type="submit">
              {isSubmitting ? 'Creating' : 'Create key'}
            </button>
          )}
        </ApiKeyForm.Subscribe>
        </form>
      </FormDialog>

      <Drawer
        open={detailKey !== undefined}
        title={detailKey?.name ?? ''}
        description="API key details"
        onClose={() => setDetailKey(undefined)}
      >
        {detailKey ? (
          <div className="grid gap-4">
            <dl className="grid gap-3 text-sm">
              <div className="grid gap-0.5">
                <dt className="text-muted">Key ID</dt>
                <dd className="break-all font-mono">{detailKey.id}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">Name</dt>
                <dd className="font-medium">{detailKey.name}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">Scopes</dt>
                <dd className="font-mono">{detailKey.scopes.join(', ') || '—'}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">Created</dt>
                <dd>{new Date(detailKey.createdAt).toLocaleString()}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">Status</dt>
                <dd>
                  <span className={`rm-status ${detailKey.revokedAt ? 'fail' : 'pass'}`}>
                    {detailKey.revokedAt ? 'revoked' : 'active'}
                  </span>
                </dd>
              </div>
              {detailKey.revokedAt ? (
                <div className="grid gap-0.5">
                  <dt className="text-muted">Revoked</dt>
                  <dd>{new Date(detailKey.revokedAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
            <div>
              <button
                className="rm-button danger"
                disabled={detailKey.revokedAt !== undefined || revokeMutation.isPending}
                onClick={() => void handleRevoke(detailKey.id)}
                type="button"
              >
                {detailKey.revokedAt ? 'Revoked' : 'Revoke key'}
              </button>
            </div>
          </div>
        ) : null}
      </Drawer>
      {dialog}
    </section>
  )
}
