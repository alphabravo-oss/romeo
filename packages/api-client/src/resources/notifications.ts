import { pathId } from '../path'
import type { RomeoTransport } from '../transport'
import type {
  CreateNotificationChannelInput,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationPolicyReport,
  NotificationRetryResult,
  UpdateNotificationPolicyInput,
  UserNotification
} from '../types'

export function createNotificationResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<UserNotification[]>('GET', '/api/v1/notifications'),
    markRead: (notificationId: string) => transport.data<UserNotification>('POST', `/api/v1/notifications/${pathId(notificationId)}/read`),
    channels: () => transport.data<NotificationDeliveryChannel[]>('GET', '/api/v1/notification-channels'),
    createChannel: (input: CreateNotificationChannelInput) => transport.data<NotificationDeliveryChannel>('POST', '/api/v1/notification-channels', input),
    deliveries: () => transport.data<NotificationDelivery[]>('GET', '/api/v1/notification-deliveries'),
    retryDue: () => transport.data<NotificationRetryResult>('POST', '/api/v1/notification-deliveries/retry-due'),
    policy: () => transport.data<NotificationPolicyReport>('GET', '/api/v1/admin/notification-policy'),
    updatePolicy: (input: UpdateNotificationPolicyInput) => transport.data<NotificationPolicyReport>('PATCH', '/api/v1/admin/notification-policy', input)
  }
}
