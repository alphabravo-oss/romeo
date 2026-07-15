import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  CreateNotificationChannelInput,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationPolicyReport,
  UpdateNotificationPolicyRequest
} from './notification-channel-types'

export async function listNotificationChannels(): Promise<NotificationDeliveryChannel[]> {
  const response = await apiJson<Envelope<NotificationDeliveryChannel[]>>('/api/v1/notification-channels')
  return response.data
}

export async function createNotificationChannel(
  input: CreateNotificationChannelInput
): Promise<NotificationDeliveryChannel> {
  const response = await apiJson<Envelope<NotificationDeliveryChannel>>('/api/v1/notification-channels', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function listNotificationDeliveries(): Promise<NotificationDelivery[]> {
  const response = await apiJson<Envelope<NotificationDelivery[]>>('/api/v1/notification-deliveries')
  return response.data
}

export async function getNotificationPolicy(): Promise<NotificationPolicyReport> {
  const response = await apiJson<Envelope<NotificationPolicyReport>>('/api/v1/admin/notification-policy')
  return response.data
}

export async function updateNotificationPolicy(
  input: UpdateNotificationPolicyRequest
): Promise<NotificationPolicyReport> {
  const response = await apiJson<Envelope<NotificationPolicyReport>>('/api/v1/admin/notification-policy', {
    method: 'PATCH',
    body: JSON.stringify(input)
  })
  return response.data
}
