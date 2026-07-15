import { apiJson } from './http'
import type { Envelope, UserNotification } from './types'

export async function listNotifications(): Promise<UserNotification[]> {
  const response = await apiJson<Envelope<UserNotification[]>>('/api/v1/notifications')
  return response.data
}

export async function markNotificationRead(notificationId: string): Promise<UserNotification> {
  const response = await apiJson<Envelope<UserNotification>>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST'
  })
  return response.data
}
