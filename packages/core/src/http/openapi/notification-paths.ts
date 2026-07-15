import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const notificationPaths = {
  "/notifications": {
    get: {
      summary: "List current user notifications",
      responses: {
        200: arrayEnvelope("User notification"),
        403: errorResponse,
      },
    },
  },
  "/notifications/{notificationId}/read": {
    post: {
      summary: "Mark a user notification read",
      parameters: [
        {
          name: "notificationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("User notification"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/notification-channels": {
    get: {
      summary: "List current user notification delivery channels",
      description:
        "Returns sanitized channel config summaries only. Destination URLs, email addresses, PagerDuty routing-key refs, and mobile-push token refs are not returned.",
      responses: {
        200: success("Notification delivery channels", {
          type: "array",
          items: { $ref: "#/components/schemas/NotificationDeliveryChannel" },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a current user notification delivery channel",
      description:
        "Stores full normalized channel config internally for delivery, while public readback returns only destination posture and secret-ref schemes.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateNotificationChannelRequest",
        }),
      },
      responses: {
        201: success("Notification delivery channel", {
          $ref: "#/components/schemas/NotificationDeliveryChannel",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/notification-deliveries": {
    get: {
      summary: "List current user notification delivery ledger records",
      responses: {
        200: arrayEnvelope("Notification delivery"),
        403: errorResponse,
      },
    },
  },
  "/notification-deliveries/retry-due": {
    post: {
      summary: "Retry due failed notification deliveries",
      responses: {
        202: created("Notification retry job result"),
        403: errorResponse,
      },
    },
  },
  "/admin/notification-policy": {
    get: {
      summary: "Inspect organization notification delivery policy",
      responses: {
        200: success("Notification policy report", {
          $ref: "#/components/schemas/NotificationPolicyReport",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update organization notification delivery policy",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateNotificationPolicyRequest",
        }),
      },
      responses: {
        200: success("Notification policy report", {
          $ref: "#/components/schemas/NotificationPolicyReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
};
