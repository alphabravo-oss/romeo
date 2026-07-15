import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  approveImpersonationRequest,
  listImpersonationRequests,
  rejectImpersonationRequest
} from '../api/impersonation-client'
import {
  type ImpersonationSession,
  listImpersonationSessions,
  revokeImpersonationSession
} from '../api/impersonation-session-client'
import type { ImpersonationRequest } from '../api/impersonation-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const requestCol = createColumnHelper<ImpersonationRequest>()
const sessionCol = createColumnHelper<ImpersonationSession>()

export function ImpersonationPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const requestsQuery = useQuery({ queryKey: ['impersonationRequests'], queryFn: listImpersonationRequests })
  const sessionsQuery = useQuery({ queryKey: ['impersonationSessions'], queryFn: listImpersonationSessions })
  const approveMutation = useMutation({ mutationFn: approveImpersonationRequest })
  const rejectMutation = useMutation({ mutationFn: rejectImpersonationRequest })
  const revokeMutation = useMutation({ mutationFn: revokeImpersonationSession })

  const pending = useMemo(
    () => (requestsQuery.data ?? []).filter((request) => request.status === 'pending'),
    [requestsQuery.data]
  )

  const activeSessions = useMemo(
    () => (sessionsQuery.data ?? []).filter((entry) => entry.status === 'active'),
    [sessionsQuery.data]
  )

  const columns = useMemo<ColumnDef<ImpersonationRequest, any>[]>(
    () => [
      requestCol.accessor('targetUserId', {
        header: 'Target user',
        cell: (c) => <span className="rm-mono">{c.getValue()}</span>
      }),
      requestCol.accessor('requestedByUserId', {
        header: 'Requested by',
        cell: (c) => <span className="rm-mono">{c.getValue()}</span>
      }),
      requestCol.accessor('ttlMinutes', {
        header: 'TTL (min)',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      requestCol.accessor((row) => row.ticketRef ?? '', {
        id: 'ticketRef',
        header: 'Ticket',
        cell: (c) => <span className="rm-cell-muted">{c.getValue() || '—'}</span>
      }),
      requestCol.accessor((row) => new Date(row.createdAt).toLocaleString(), {
        id: 'createdAt',
        header: 'Requested',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      requestCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <span className="flex gap-2">
            <button
              className="rm-button"
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => void handleApprove(c.row.original.id)}
              type="button"
            >
              Approve
            </button>
            <button
              className="rm-button"
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => void handleReject(c.row.original.id)}
              type="button"
            >
              Reject
            </button>
          </span>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approveMutation.isPending, rejectMutation.isPending]
  )

  const sessionColumns = useMemo<ColumnDef<ImpersonationSession, any>[]>(
    () => [
      sessionCol.accessor('adminUserId', {
        header: 'Impersonator',
        cell: (c) => <span className="rm-mono">{c.getValue()}</span>
      }),
      sessionCol.accessor('targetUserId', {
        header: 'Target user',
        cell: (c) => <span className="rm-mono">{c.getValue()}</span>
      }),
      sessionCol.accessor((row) => row.ttlMinutes ?? '', {
        id: 'ttlMinutes',
        header: 'TTL (min)',
        cell: (c) => <span className="rm-cell-muted">{c.getValue() || '—'}</span>
      }),
      sessionCol.accessor((row) => new Date(row.session.createdAt).toLocaleString(), {
        id: 'createdAt',
        header: 'Started',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      sessionCol.accessor((row) => new Date(row.session.expiresAt).toLocaleString(), {
        id: 'expiresAt',
        header: 'Expires',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      sessionCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className="rm-button"
            disabled={revokeMutation.isPending}
            onClick={() => void handleRevoke(c.row.original.session.id)}
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

  async function handleApprove(requestId: string) {
    try {
      await approveMutation.mutateAsync(requestId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['impersonationRequests'] }),
        queryClient.invalidateQueries({ queryKey: ['impersonationSessions'] })
      ])
      toast('Request approved', 'success')
    } catch {
      toast('Could not approve request', 'error')
    }
  }

  async function handleReject(requestId: string) {
    try {
      await rejectMutation.mutateAsync(requestId)
      await queryClient.invalidateQueries({ queryKey: ['impersonationRequests'] })
      toast('Request rejected', 'success')
    } catch {
      toast('Could not reject request', 'error')
    }
  }

  async function handleRevoke(sessionId: string) {
    if (
      !(await ask({
        title: 'Revoke session?',
        body: 'The impersonation session ends immediately.',
        confirmLabel: 'Revoke',
        tone: 'danger'
      }))
    )
      return
    try {
      await revokeMutation.mutateAsync(sessionId)
      await queryClient.invalidateQueries({ queryKey: ['impersonationSessions'] })
      toast('Session revoked', 'success')
    } catch {
      toast('Could not revoke session', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Impersonation requests</div>
        <button
          className="rm-button"
          disabled={requestsQuery.isFetching}
          onClick={() => void requestsQuery.refetch()}
          type="button"
        >
          {requestsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-4">
        <DataTable columns={columns} data={pending} empty="No pending requests." />
      </div>

      <div className="rm-card-header mt-6">
        <div className="rm-card-title">Active sessions</div>
        <button
          className="rm-button"
          disabled={sessionsQuery.isFetching}
          onClick={() => void sessionsQuery.refetch()}
          type="button"
        >
          {sessionsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-4">
        <PanelState query={sessionsQuery} empty="No active sessions." isEmpty={() => activeSessions.length === 0}>
          {() => <DataTable columns={sessionColumns} data={activeSessions} />}
        </PanelState>
      </div>
      {dialog}
    </section>
  )
}
