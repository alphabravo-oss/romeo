export type NotificationType = 'chat_mention'
export type NotificationDeliveryChannelType = 'email' | 'mobile_push' | 'pagerduty' | 'slack' | 'teams' | 'webhook'
export type NotificationDeliveryStatus = 'disabled' | 'failed' | 'pending' | 'sent'

export interface UserNotification {
  id: string
  type: NotificationType
  actorId: string
  resourceType: 'chat'
  resourceId: string
  metadata: Record<string, unknown>
  readAt?: string
  createdAt: string
}

export interface NotificationDeliveryChannel {
  id: string
  type: NotificationDeliveryChannelType
  name: string
  config: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface NotificationDelivery {
  id: string
  notificationId: string
  channelId: string
  status: NotificationDeliveryStatus
  attemptCount: number
  errorCode?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deliveredAt?: string
}
