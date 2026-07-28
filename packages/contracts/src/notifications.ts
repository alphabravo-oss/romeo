import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
export const NotificationTypeSchema = z
  .enum([
    "chat_mention",
    "support_impersonation_request_created",
    "support_impersonation_request_approved",
    "support_impersonation_request_rejected",
    "support_impersonation_session_created",
    "support_impersonation_session_revoked",
  ])
  .openapi("NotificationType");
export const NotificationDeliveryChannelTypeSchema = z
  .enum(["email", "mobile_push", "pagerduty", "slack", "teams", "webhook"])
  .openapi("NotificationDeliveryChannelType");

export const UserNotificationSchema = z
  .strictObject({
    id,
    orgId: id,
    userId: id,
    type: NotificationTypeSchema,
    actorId: id,
    resourceType: z.enum([
      "chat",
      "support_impersonation_request",
      "support_impersonation_session",
    ]),
    resourceId: id,
    metadata: z.record(z.string(), z.unknown()),
    readAt: time.optional(),
    createdAt: time,
  })
  .openapi("UserNotification");

const enabledTypes = z.array(NotificationTypeSchema).max(20).optional();
const emailPublicConfig = z.strictObject({
  destinationConfigured: z.boolean(),
  toDomain: z.string(),
  enabledNotificationTypes: enabledTypes,
});
const urlPublicConfig = z.strictObject({
  destinationConfigured: z.boolean(),
  urlHost: z.string(),
  enabledNotificationTypes: enabledTypes,
});
const mobilePublicConfig = z.strictObject({
  tokenConfigured: z.boolean(),
  tokenRefScheme: z.string(),
  platform: z.enum(["android", "ios", "web"]).optional(),
  collapseKey: z.string().optional(),
  enabledNotificationTypes: enabledTypes,
});
const pagerDutyPublicConfig = z.strictObject({
  routingKeyConfigured: z.boolean(),
  routingKeyRefScheme: z.string(),
  severity: z.enum(["critical", "error", "info", "warning"]).optional(),
  enabledNotificationTypes: enabledTypes,
});
export const NotificationDeliveryChannelSchema = z
  .strictObject({
    id,
    orgId: id,
    userId: id,
    type: NotificationDeliveryChannelTypeSchema,
    name: z.string(),
    config: z.union([
      emailPublicConfig,
      urlPublicConfig,
      mobilePublicConfig,
      pagerDutyPublicConfig,
    ]),
    enabled: z.boolean(),
    createdAt: time,
    updatedAt: time,
  })
  .describe(
    "Public notification channel metadata. Destination values, secret refs, routing keys, and mobile device-token refs are redacted from config readback.",
  )
  .openapi("NotificationDeliveryChannel");
export const NotificationDeliverySchema = z
  .strictObject({
    id,
    orgId: id,
    userId: id,
    notificationId: id,
    channelId: id,
    status: z.enum(["disabled", "failed", "pending", "sent"]),
    attemptCount: z.number().int().min(0),
    errorCode: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: time,
    updatedAt: time,
    deliveredAt: time.optional(),
  })
  .openapi("NotificationDelivery");

const channelPreference = {
  enabledNotificationTypes: enabledTypes,
};
export const CreateNotificationChannelSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("email"),
      name: z.string().min(1).max(120),
      config: z.strictObject({
        ...channelPreference,
        to: z.email().max(254),
      }),
    }),
    z.strictObject({
      type: z.literal("mobile_push"),
      name: z.string().min(1).max(120),
      config: z.strictObject({
        ...channelPreference,
        tokenRef: z.string().min(1).max(512),
        platform: z.enum(["android", "ios", "web"]).optional(),
        collapseKey: z.string().min(1).max(64).optional(),
      }),
    }),
    z.strictObject({
      type: z.literal("pagerduty"),
      name: z.string().min(1).max(120),
      config: z.strictObject({
        ...channelPreference,
        routingKeyRef: z.string().min(1).max(512),
        severity: z.enum(["critical", "error", "info", "warning"]).optional(),
      }),
    }),
    ...(["slack", "teams", "webhook"] as const).map((type) =>
      z.strictObject({
        type: z.literal(type),
        name: z.string().min(1).max(120),
        config: z.strictObject({
          ...channelPreference,
          url: z.url().max(2_048),
        }),
      }),
    ),
  ])
  .openapi("CreateNotificationChannelRequest");

export const NotificationPolicySchema = z
  .strictObject({
    deliveryEnabled: z.boolean(),
    allowedChannelTypes: z.array(NotificationDeliveryChannelTypeSchema),
    allowedWebhookHosts: z.array(z.string()),
    allowedSlackHosts: z.array(z.string()),
    allowedTeamsHosts: z.array(z.string()),
    allowedEmailDomains: z.array(z.string()),
    suppressedNotificationTypes: z.array(NotificationTypeSchema),
  })
  .openapi("NotificationPolicy");
const NotificationPolicyPostureSchema = z
  .strictObject({
    deliveryEnabled: z.boolean(),
    channelTypeRestrictionActive: z.boolean(),
    webhookHostRestrictionActive: z.boolean(),
    slackHostRestrictionActive: z.boolean(),
    teamsHostRestrictionActive: z.boolean(),
    emailDomainRestrictionActive: z.boolean(),
    suppressedNotificationTypeCount: z.number().int().min(0),
  })
  .openapi("NotificationPolicyPosture");
export const NotificationPolicyReportSchema = z
  .strictObject({
    orgId: id,
    policy: NotificationPolicySchema,
    posture: NotificationPolicyPostureSchema,
    updatedAt: time.optional(),
    updatedBy: id.optional(),
  })
  .openapi("NotificationPolicyReport");
export const UpdateNotificationPolicySchema = z
  .strictObject({
    deliveryEnabled: z.boolean().optional(),
    allowedChannelTypes: z
      .array(NotificationDeliveryChannelTypeSchema)
      .max(6)
      .optional(),
    allowedWebhookHosts: z
      .array(z.string().min(1).max(253))
      .max(100)
      .optional(),
    allowedSlackHosts: z.array(z.string().min(1).max(253)).max(100).optional(),
    allowedTeamsHosts: z.array(z.string().min(1).max(253)).max(100).optional(),
    allowedEmailDomains: z
      .array(z.string().min(1).max(253))
      .max(100)
      .optional(),
    suppressedNotificationTypes: z
      .array(NotificationTypeSchema)
      .max(20)
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one notification policy field is required.",
  })
  .openapi("UpdateNotificationPolicyRequest");

const backgroundJob = z.strictObject({
  id,
  orgId: id,
  workspaceId: id.optional(),
  type: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: time,
  updatedAt: time,
  completedAt: time.optional(),
});
const notificationPath = z.strictObject({ notificationId: id });
const meta = { tags: ["Notifications"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const listNotificationsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/notifications",
  operationId: "notifications.list",
  summary: "List",
  responses: {
    200: jsonResponse(
      "User notifications",
      dataEnvelope(z.array(UserNotificationSchema)),
    ),
    ...errors,
  },
});
export const markNotificationReadRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/notifications/{notificationId}/read",
  operationId: "notifications.markRead",
  summary: "Mark read",
  request: { params: notificationPath },
  responses: {
    200: jsonResponse(
      "Read notification",
      dataEnvelope(UserNotificationSchema),
    ),
    ...errors,
  },
});
export const listNotificationChannelsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/notification-channels",
  operationId: "notifications.listChannels",
  summary: "List channels",
  responses: {
    200: jsonResponse(
      "Notification delivery channels",
      dataEnvelope(z.array(NotificationDeliveryChannelSchema)),
    ),
    ...errors,
  },
});
export const createNotificationChannelRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/notification-channels",
  operationId: "notifications.createChannel",
  summary: "Create channel",
  request: { body: body(CreateNotificationChannelSchema) },
  responses: {
    201: jsonResponse(
      "Notification delivery channel",
      dataEnvelope(NotificationDeliveryChannelSchema),
    ),
    ...errors,
  },
});
export const listNotificationDeliveriesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/notification-deliveries",
  operationId: "notifications.listDeliveries",
  summary: "List deliveries",
  responses: {
    200: jsonResponse(
      "Notification deliveries",
      dataEnvelope(z.array(NotificationDeliverySchema)),
    ),
    ...errors,
  },
});
export const retryDueNotificationDeliveriesRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/notification-deliveries/retry-due",
  operationId: "notifications.retryDueDeliveries",
  summary: "Retry due deliveries",
  responses: {
    202: jsonResponse(
      "Notification retry job result",
      dataEnvelope(
        z.strictObject({
          job: backgroundJob,
          deliveries: z.array(NotificationDeliverySchema),
        }),
      ),
    ),
    ...errors,
  },
});
export const getNotificationPolicyRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/admin/notification-policy",
  operationId: "notifications.getPolicy",
  summary: "Get policy",
  responses: {
    200: jsonResponse(
      "Notification policy",
      dataEnvelope(NotificationPolicyReportSchema),
    ),
    ...errors,
  },
});
export const updateNotificationPolicyRoute = createRoute({
  ...meta,
  method: "patch",
  path: "/api/v1/admin/notification-policy",
  operationId: "notifications.updatePolicy",
  summary: "Update policy",
  request: { body: body(UpdateNotificationPolicySchema) },
  responses: {
    200: jsonResponse(
      "Notification policy",
      dataEnvelope(NotificationPolicyReportSchema),
    ),
    ...errors,
  },
});

export const notificationRoutes = [
  listNotificationsRoute,
  markNotificationReadRoute,
  listNotificationChannelsRoute,
  createNotificationChannelRoute,
  listNotificationDeliveriesRoute,
  retryDueNotificationDeliveriesRoute,
  getNotificationPolicyRoute,
  updateNotificationPolicyRoute,
] as const;
