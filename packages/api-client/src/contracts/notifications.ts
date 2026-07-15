import type { BackgroundJob } from "./admin";

export type NotificationType =
  | "chat_mention"
  | "support_impersonation_request_created"
  | "support_impersonation_request_approved"
  | "support_impersonation_request_rejected"
  | "support_impersonation_session_created"
  | "support_impersonation_session_revoked";
export type NotificationResourceType =
  | "chat"
  | "support_impersonation_request"
  | "support_impersonation_session";
export type NotificationDeliveryChannelType =
  | "email"
  | "mobile_push"
  | "pagerduty"
  | "slack"
  | "teams"
  | "webhook";
export type NotificationDeliveryStatus =
  | "disabled"
  | "failed"
  | "pending"
  | "sent";

export interface UserNotification {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  actorId: string;
  resourceType: NotificationResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

export interface NotificationDeliveryChannel {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationDeliveryChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateNotificationChannelInput =
  | {
      type: "email";
      name: string;
      config: {
        to: string;
        enabledNotificationTypes?: NotificationType[];
      };
    }
  | {
      type: "mobile_push";
      name: string;
      config: {
        tokenRef: string;
        platform?: "android" | "ios" | "web";
        collapseKey?: string;
        enabledNotificationTypes?: NotificationType[];
      };
    }
  | {
      type: "pagerduty";
      name: string;
      config: {
        routingKeyRef: string;
        severity?: "critical" | "error" | "info" | "warning";
        enabledNotificationTypes?: NotificationType[];
      };
    }
  | {
      type: "webhook";
      name: string;
      config: {
        url: string;
        enabledNotificationTypes?: NotificationType[];
      };
    }
  | {
      type: "slack";
      name: string;
      config: {
        url: string;
        enabledNotificationTypes?: NotificationType[];
      };
    }
  | {
      type: "teams";
      name: string;
      config: {
        url: string;
        enabledNotificationTypes?: NotificationType[];
      };
    };

export interface NotificationDelivery {
  id: string;
  orgId: string;
  userId: string;
  notificationId: string;
  channelId: string;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface NotificationRetryResult {
  job: BackgroundJob;
  deliveries: NotificationDelivery[];
}

export interface NotificationPolicy {
  deliveryEnabled: boolean;
  allowedChannelTypes: NotificationDeliveryChannelType[];
  allowedWebhookHosts: string[];
  allowedSlackHosts: string[];
  allowedTeamsHosts: string[];
  allowedEmailDomains: string[];
  suppressedNotificationTypes: NotificationType[];
}

export interface NotificationPolicyPosture {
  deliveryEnabled: boolean;
  channelTypeRestrictionActive: boolean;
  webhookHostRestrictionActive: boolean;
  slackHostRestrictionActive: boolean;
  teamsHostRestrictionActive: boolean;
  emailDomainRestrictionActive: boolean;
  suppressedNotificationTypeCount: number;
}

export interface NotificationPolicyReport {
  orgId: string;
  policy: NotificationPolicy;
  posture: NotificationPolicyPosture;
  updatedAt?: string;
  updatedBy?: string;
}

export type UpdateNotificationPolicyInput = Partial<NotificationPolicy>;
