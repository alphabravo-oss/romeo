import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType
} from './types'

export type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType
}

/**
 * Body for POST /api/v1/notification-channels (createNotificationChannelSchema —
 * a discriminated union on `type`).
 */
export type CreateNotificationChannelInput =
  | { type: 'email'; name: string; config: { to: string } }
  | {
      type: 'mobile_push'
      name: string
      config: {
        tokenRef: string
        platform?: 'android' | 'ios' | 'web'
        collapseKey?: string
        enabledNotificationTypes?: NotificationType[]
      }
    }
  | {
      type: 'pagerduty'
      name: string
      config: {
        routingKeyRef: string
        severity?: 'critical' | 'error' | 'info' | 'warning'
        enabledNotificationTypes?: NotificationType[]
      }
    }
  | { type: 'slack'; name: string; config: { url: string } }
  | { type: 'teams'; name: string; config: { url: string } }
  | { type: 'webhook'; name: string; config: { url: string } }

// ===== Notification policy (GET/PATCH /api/v1/admin/notification-policy) =====

/** Kinds of notifications that can be suppressed. Currently only `chat_mention`. */
export type NotificationType = 'chat_mention'

/** Delivery channel types governed by the org policy. */
export type NotificationPolicyChannelType = NotificationDeliveryChannelType

/** Editable notification policy state (nested under report.policy). */
export interface NotificationPolicy {
  deliveryEnabled: boolean
  allowedChannelTypes: NotificationPolicyChannelType[]
  allowedWebhookHosts: string[]
  allowedSlackHosts: string[]
  allowedTeamsHosts: string[]
  allowedEmailDomains: string[]
  suppressedNotificationTypes: NotificationType[]
}

/** Read-only derived posture (GET response only). */
export interface NotificationPolicyPosture {
  deliveryEnabled: boolean
  channelTypeRestrictionActive: boolean
  webhookHostRestrictionActive: boolean
  slackHostRestrictionActive: boolean
  teamsHostRestrictionActive: boolean
  emailDomainRestrictionActive: boolean
  suppressedNotificationTypeCount: number
}

/** Full report returned by both GET and PATCH (enveloped as { data }). */
export interface NotificationPolicyReport {
  orgId: string
  policy: NotificationPolicy
  posture: NotificationPolicyPosture
  updatedAt?: string
  updatedBy?: string
}

/**
 * Body for PATCH /api/v1/admin/notification-policy. All fields optional but at
 * least one is required (updateNotificationPolicySchema refine). Flat object,
 * not nested under `policy`, not enveloped.
 */
export interface UpdateNotificationPolicyRequest {
  deliveryEnabled?: boolean
  allowedChannelTypes?: NotificationPolicyChannelType[]
  allowedWebhookHosts?: string[]
  allowedSlackHosts?: string[]
  allowedTeamsHosts?: string[]
  allowedEmailDomains?: string[]
  suppressedNotificationTypes?: NotificationType[]
}
