export type {
  CreateNotificationChannelRequest,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  NotificationPolicy,
  NotificationPolicyPosture,
  NotificationPolicyReport,
  NotificationType,
  UpdateNotificationPolicyRequest,
  UserNotification,
} from "@romeo/api-client/generated/sdk";
import type { NotificationType } from "@romeo/api-client/generated/sdk";
import { zNotificationType } from "@romeo/api-client/generated/sdk/zod";
import { zNotificationDeliveryChannelType } from "@romeo/api-client/generated/sdk/zod";

export const notificationTypes =
  zNotificationType.options satisfies readonly NotificationType[];
export const notificationChannelTypes =
  zNotificationDeliveryChannelType.options satisfies readonly import("@romeo/api-client/generated/sdk").NotificationDeliveryChannelType[];
export type CreateNotificationChannelInput =
  import("@romeo/api-client/generated/sdk").CreateNotificationChannelRequest;
export type NotificationDeliveryStatus =
  import("@romeo/api-client/generated/sdk").NotificationDelivery["status"];
