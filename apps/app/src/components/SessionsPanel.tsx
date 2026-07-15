import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { listSessions, revokeOtherSessions, revokeSession } from '../api/sessions-client'
import type { Session } from '../api/sessions-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<Session>()

function sessionStatus(session: Session): 'active' | 'expired' | 'revoked' {
  if (session.revokedAt !== undefined) return 'revoked'
  if (new Date(session.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'active'
}

export function SessionsPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const sessionsQuery = useQuery({ queryKey: ['sessions'], queryFn: listSessions })
  const revokeMutation = useMutation({ mutationFn: (sessionId: string) => revokeSession(sessionId) })
  const revokeOthersMutation = useMutation({ mutationFn: revokeOtherSessions })

  async function handleRevoke(session: Session) {
    if (
      !(await ask({
        title: 'Sign out this session?',
        body: 'This immediately revokes the selected session.',
        confirmLabel: 'Revoke',
        tone: 'danger'
      }))
    )
      return
    try {
      await revokeMutation.mutateAsync(session.id)
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast('Session revoked', 'success')
    } catch {
      toast('Could not revoke session', 'error')
    }
  }

  async function handleRevokeOthers() {
    if (
      !(await ask({
        title: 'Sign out everywhere else?',
        body: 'This revokes all of your other sessions. Your current session stays signed in.',
        confirmLabel: 'Sign out everywhere else',
        tone: 'danger'
      }))
    )
      return
    try {
      const revoked = await revokeOthersMutation.mutateAsync()
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast(`Revoked ${revoked.length} other session${revoked.length === 1 ? '' : 's'}`, 'success')
    } catch {
      toast('Could not revoke other sessions', 'error')
    }
  }

  const columns = useMemo<ColumnDef<Session, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Device',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      col.accessor('createdAt', {
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
      }),
      col.accessor((row) => row.lastSeenAt ?? '', {
        id: 'lastSeen',
        header: 'Last seen',
        cell: (c) => (
          <span className="rm-cell-muted">{c.getValue() ? new Date(c.getValue()).toLocaleString() : '—'}</span>
        )
      }),
      col.accessor((row) => row.expiresAt, {
        id: 'expires',
        header: 'Expires',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>
      }),
      col.accessor((row) => sessionStatus(row), {
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
            disabled={sessionStatus(c.row.original) !== 'active' || revokeMutation.isPending}
            onClick={() => void handleRevoke(c.row.original)}
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
        <div className="rm-card-title">Active sessions</div>
        <div className="flex gap-2">
          <button
            className="rm-button danger"
            disabled={revokeOthersMutation.isPending}
            onClick={() => void handleRevokeOthers()}
            type="button"
          >
            {revokeOthersMutation.isPending ? 'Signing out' : 'Sign out everywhere else'}
          </button>
          <button
            className="rm-button"
            disabled={sessionsQuery.isFetching}
            onClick={() => void sessionsQuery.refetch()}
            type="button"
          >
            {sessionsQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="mt-4">
        <PanelState query={sessionsQuery} empty="No active sessions.">
          {(rows) => <DataTable columns={columns} data={rows} empty="No active sessions." />}
        </PanelState>
      </div>
      {dialog}
    </section>
  )
}
