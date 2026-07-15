import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  getDelegatedOauthPosture,
  listDelegatedOAuthConnections,
  listDelegatedOAuthProviders,
  revokeDelegatedOAuthConnection,
  startDelegatedOAuth
} from '../api/delegated-oauth-client'
import type {
  DelegatedOAuthConnectionSummary,
  DelegatedOAuthProvider
} from '../api/delegated-oauth-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { PanelStats } from './PanelStats'
import { useWorkspace } from './WorkspaceContext'

const connectionCol = createColumnHelper<DelegatedOAuthConnectionSummary>()

export function ConnectedAppsPanel() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspace()
  const { ask, dialog } = useConfirm()

  const providersQuery = useQuery({
    queryKey: ['delegatedOAuthProviders'],
    queryFn: listDelegatedOAuthProviders
  })
  const connectionsQuery = useQuery({
    queryKey: ['delegatedOAuthConnections', workspaceId ?? null],
    queryFn: () => listDelegatedOAuthConnections(workspaceId)
  })
  const postureQuery = useQuery({
    queryKey: ['delegatedOAuthPosture'],
    queryFn: getDelegatedOauthPosture
  })
  const startMutation = useMutation({ mutationFn: startDelegatedOAuth })
  const revokeMutation = useMutation({ mutationFn: revokeDelegatedOAuthConnection })

  async function handleConnect(provider: DelegatedOAuthProvider) {
    if (workspaceId === undefined) {
      toast('Select a workspace first', 'error')
      return
    }
    const connectorType = provider.connectorTypes[0]
    if (connectorType === undefined) {
      toast('Provider has no connector types', 'error')
      return
    }
    try {
      const result = await startMutation.mutateAsync({
        providerId: provider.id,
        workspaceId,
        connectorType
      })
      window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer')
      toast('Authorization link opened', 'success')
    } catch {
      toast('Could not start connection', 'error')
    }
  }

  async function handleRevoke(connectionId: string) {
    if (
      !(await ask({
        title: 'Revoke connection?',
        body: 'The connected app will lose access until re-authorized.',
        confirmLabel: 'Revoke',
        tone: 'danger'
      }))
    )
      return
    try {
      await revokeMutation.mutateAsync(connectionId)
      await queryClient.invalidateQueries({ queryKey: ['delegatedOAuthConnections'] })
      toast('Connection revoked', 'success')
    } catch {
      toast('Could not revoke connection', 'error')
    }
  }

  const columns = useMemo<ColumnDef<DelegatedOAuthConnectionSummary, any>[]>(
    () => [
      connectionCol.accessor('providerId', {
        header: 'Provider',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      connectionCol.accessor((row) => row.providerAccountLogin ?? row.providerAccountId, {
        id: 'account',
        header: 'Account',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      connectionCol.accessor('connectorType', {
        header: 'Connector',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      connectionCol.accessor('status', {
        header: 'Status',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      connectionCol.accessor((row) => new Date(row.createdAt).toLocaleString(), {
        id: 'createdAt',
        header: 'Connected',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      connectionCol.display({
        id: 'actions',
        header: '',
        cell: (c) =>
          c.row.original.status === 'revoked' ? null : (
            <button
              className="rm-button"
              disabled={revokeMutation.isPending}
              onClick={() => void handleRevoke(c.row.original.id)}
              type="button"
            >
              Revoke
            </button>
          )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending]
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Connected apps</div>
        <button
          className="rm-button"
          disabled={connectionsQuery.isFetching}
          onClick={() => void connectionsQuery.refetch()}
          type="button"
        >
          {connectionsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="mt-3">
        <div className="text-sm text-muted">Posture</div>
        <div className="mt-2">
          <PanelState query={postureQuery} empty="No posture data.">
            {(posture) => {
              const totals = posture.providers.reduce(
                (acc, provider) => ({
                  active: acc.active + provider.connectionCounts.active,
                  expiringAccessToken:
                    acc.expiringAccessToken + provider.connectionCounts.expiringAccessToken,
                  reauthorizationRequired:
                    acc.reauthorizationRequired + provider.connectionCounts.reauthorizationRequired,
                  revoked: acc.revoked + provider.connectionCounts.revoked,
                  total: acc.total + provider.connectionCounts.total
                }),
                {
                  active: 0,
                  expiringAccessToken: 0,
                  reauthorizationRequired: 0,
                  revoked: 0,
                  total: 0
                }
              )
              return (
                <PanelStats
                  items={[
                    { label: 'Status', value: posture.status.replace('_', ' ') },
                    { label: 'Providers', value: posture.providers.length },
                    { label: 'Connections', value: totals.total },
                    { label: 'Active', value: totals.active },
                    { label: 'Reauth required', value: totals.reauthorizationRequired },
                    { label: 'Expiring tokens', value: totals.expiringAccessToken },
                    { label: 'Revoked', value: totals.revoked },
                    { label: 'Warnings', value: posture.warnings.length }
                  ]}
                />
              )
            }}
          </PanelState>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-muted">Available providers</div>
        <div className="mt-2">
          <PanelState query={providersQuery} empty="No providers available.">
            {(providers) => (
              <div className="grid gap-2 text-sm">
                {providers.map((provider) => (
                  <div className="rounded-md border border-border p-3" key={provider.id}>
                    <div className="font-medium">{provider.displayName}</div>
                    <div className="break-words text-muted">
                      {provider.authorizationHost}
                      {provider.configured ? '' : ' - not configured'}
                    </div>
                    <button
                      className="rm-button mt-2"
                      disabled={!provider.configured || startMutation.isPending}
                      onClick={() => void handleConnect(provider)}
                      type="button"
                    >
                      {startMutation.isPending ? 'Connecting' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </PanelState>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-muted">Active connections</div>
        <div className="mt-2">
          <PanelState query={connectionsQuery} empty="No connections yet.">
            {(rows) => <DataTable columns={columns} data={rows} />}
          </PanelState>
        </div>
      </div>
      {dialog}
    </section>
  )
}
