import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { listNotifications, markNotificationRead } from '../api/client'
import { toast } from '../lib/toast'
import type { UserNotification } from '../api/notification-types'
import { PanelState } from '../lib/panel-state'
import { PanelStats } from './PanelStats'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'

const col = createColumnHelper<UserNotification>()

export function NotificationPanel() {
  const queryClient = useQueryClient()
  const notificationsQuery = useQuery({ queryKey: ['notifications'], queryFn: listNotifications })
  const readMutation = useMutation({ mutationFn: markNotificationRead })

  async function handleRead(notificationId: string) {
    try {
      await readMutation.mutateAsync(notificationId)
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast('Marked as read', 'success')
    } catch {
      toast('Could not mark as read', 'error')
    }
  }

  const columns = useMemo<ColumnDef<UserNotification, any>[]>(
    () => [
      col.accessor('type', {
        header: 'Type',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor('resourceId', {
        header: 'Resource',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>,
      }),
      col.accessor((row) => (row.readAt ? 'read' : 'unread'), {
        id: 'status',
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'read' ? 'pass' : 'warn'}`}>{c.getValue()}</span>
        ),
      }),
      col.accessor('createdAt', {
        header: 'Received',
        cell: (c) => <span className="rm-cell-muted">{new Date(c.getValue()).toLocaleString()}</span>,
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className="rm-button"
            disabled={c.row.original.readAt !== undefined || readMutation.isPending}
            onClick={() => void handleRead(c.row.original.id)}
            type="button"
          >
            {c.row.original.readAt ? 'Read' : 'Mark read'}
          </button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readMutation.isPending],
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Notifications</div>
      <PanelState query={notificationsQuery} empty="No notifications">
        {(notifications) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Total', value: notifications.length },
                { label: 'Unread', value: notifications.filter((notification) => notification.readAt === undefined).length },
              ]}
            />
            <DataTable columns={columns} data={notifications} empty="No notifications" />
          </div>
        )}
      </PanelState>
    </section>
  )
}
