import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { disableUser, listUsers, setUserPassword, updateUserRole } from '../api/users-client'
import type { User, UserRole } from '../api/users-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'

const userCol = createColumnHelper<User>()

const roleOptions: { value: UserRole; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'org_admin', label: 'Org admin' },
  { value: 'global_admin', label: 'Global admin' }
]

function roleLabel(role: UserRole): string {
  return roleOptions.find((option) => option.value === role)?.label ?? role
}

export function UsersPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const disableMutation = useMutation({ mutationFn: disableUser })
  const [managing, setManaging] = useState<User>()

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  async function handleDisable(userId: string) {
    if (!(await ask({ title: 'Disable user?', body: 'They lose access immediately.', confirmLabel: 'Disable', tone: 'danger' }))) return
    try {
      await disableMutation.mutateAsync(userId)
      await refresh()
      toast('User disabled', 'success')
    } catch {
      toast('Could not disable user', 'error')
    }
  }

  const columns = useMemo<ColumnDef<User, any>[]>(
    () => [
      userCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      userCol.accessor('email', {
        header: 'Email',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      userCol.accessor('role', {
        header: 'Role',
        cell: (c) => <span className="rm-cell-muted">{roleLabel(c.getValue())}</span>
      }),
      userCol.accessor((row) => (row.disabledAt ? 'disabled' : 'active'), {
        id: 'status',
        header: 'Status',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      userCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <div className="flex justify-end gap-2">
            <button className="rm-button" onClick={() => setManaging(c.row.original)} type="button">
              Manage
            </button>
            <button
              className="rm-button danger"
              disabled={disableMutation.isPending || c.row.original.disabledAt !== undefined}
              onClick={() => void handleDisable(c.row.original.id)}
              type="button"
            >
              Disable
            </button>
          </div>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending]
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Users</div>
        <button className="rm-button" disabled={usersQuery.isFetching} onClick={() => void usersQuery.refetch()} type="button">
          {usersQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <div className="mt-4">
        <PanelState query={usersQuery} empty="No users yet.">
          {(users) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total users', value: users.length },
                  { label: 'Admins', value: users.filter((u) => u.role !== 'user').length },
                  { label: 'Disabled', value: users.filter((u) => u.disabledAt).length },
                ]}
              />
              <DataTable columns={columns} data={users} empty="No users yet." />
            </div>
          )}
        </PanelState>
      </div>
      {managing !== undefined ? (
        <UserManageDialog
          key={managing.id}
          onChanged={() => void refresh()}
          onClose={() => setManaging(undefined)}
          user={managing}
        />
      ) : null}
      {dialog}
    </section>
  )
}

function UserManageDialog({
  user,
  onClose,
  onChanged
}: {
  user: User
  onClose: () => void
  onChanged: () => void
}) {
  const [role, setRole] = useState<UserRole>(user.role)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const roleMutation = useMutation({ mutationFn: updateUserRole })
  const passwordMutation = useMutation({ mutationFn: setUserPassword })

  async function saveRole() {
    try {
      await roleMutation.mutateAsync({ userId: user.id, role })
      onChanged()
      toast('Role updated', 'success')
    } catch {
      toast('Could not update role', 'error')
    }
  }

  async function savePassword() {
    if (newPassword.length < 12) {
      toast('Password must be at least 12 characters', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'error')
      return
    }
    try {
      await passwordMutation.mutateAsync({ userId: user.id, newPassword })
      toast('Password set', 'success')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      toast('Could not set password', 'error')
    }
  }

  return (
    <FormDialog description={user.email} onClose={onClose} open title="Manage user">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Role</span>
            <select className="rm-input" onChange={(event) => setRole(event.currentTarget.value as UserRole)} value={role}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rm-button primary"
            disabled={role === user.role || roleMutation.isPending}
            onClick={() => void saveRole()}
            type="button"
          >
            {roleMutation.isPending ? 'Saving' : 'Update role'}
          </button>
        </div>
        <div className="grid gap-2 border-t border-border pt-4">
          <div className="text-sm font-medium">Set local password</div>
          <div className="text-xs text-muted">At least 12 characters. The user can sign in locally with this password.</div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">New password</span>
            <input
              autoComplete="new-password"
              className="rm-input"
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              type="password"
              value={newPassword}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Confirm password</span>
            <input
              autoComplete="new-password"
              className="rm-input"
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              type="password"
              value={confirmPassword}
            />
          </label>
          <button
            className="rm-button"
            disabled={passwordMutation.isPending || newPassword.length < 12}
            onClick={() => void savePassword()}
            type="button"
          >
            {passwordMutation.isPending ? 'Saving' : 'Set password'}
          </button>
        </div>
      </div>
    </FormDialog>
  )
}
