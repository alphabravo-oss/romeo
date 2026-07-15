import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const sessionPaths = {
  "/sessions": {
    get: {
      summary: "List local sessions for the current user",
      responses: {
        200: success("Local sessions", {
          type: "array",
          items: { $ref: "#/components/schemas/UserSession" },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Create an HttpOnly local session for the current user",
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/CreateSessionRequest",
        }),
      },
      responses: {
        201: created("Created local session", {
          $ref: "#/components/schemas/CreatedUserSession",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/sessions/current": {
    delete: {
      summary: "Revoke the current local session",
      responses: {
        200: success("Local session", {
          $ref: "#/components/schemas/UserSession",
        }),
        403: errorResponse,
      },
    },
  },
  "/sessions/revoke-others": {
    post: {
      summary: "Revoke all other active local sessions for the current user",
      responses: {
        200: success("Local sessions", {
          type: "array",
          items: { $ref: "#/components/schemas/UserSession" },
        }),
        403: errorResponse,
      },
    },
  },
  "/sessions/{sessionId}": {
    delete: {
      summary: "Revoke a local session by ID",
      parameters: [
        {
          name: "sessionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Local session", {
          $ref: "#/components/schemas/UserSession",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/impersonation/sessions": {
    get: {
      summary: "List audited support impersonation session reports",
      responses: {
        200: success("Support session reports", {
          type: "array",
          items: { $ref: "#/components/schemas/SupportSessionReport" },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Create an audited short-lived support impersonation session",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateSupportSessionRequest",
        }),
      },
      responses: {
        201: created("Created support session", {
          $ref: "#/components/schemas/CreatedUserSession",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/impersonation/sessions/{sessionId}/revoke": {
    post: {
      summary: "Revoke an audited support impersonation session",
      parameters: [
        {
          name: "sessionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Support session report", {
          $ref: "#/components/schemas/SupportSessionReport",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/impersonation/requests": {
    get: {
      summary: "List support impersonation approval requests",
      responses: {
        200: success("Support impersonation requests", {
          type: "array",
          items: {
            $ref: "#/components/schemas/SupportSessionRequestReport",
          },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a support impersonation approval request",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateSupportSessionRequest",
        }),
      },
      responses: {
        201: created("Support impersonation request", {
          $ref: "#/components/schemas/SupportSessionRequestReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/impersonation/requests/{requestId}/approve": {
    post: {
      summary: "Approve a support impersonation request and mint the session",
      parameters: [
        {
          name: "requestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        201: created("Created support session", {
          $ref: "#/components/schemas/CreatedUserSession",
        }),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/impersonation/requests/{requestId}/reject": {
    post: {
      summary: "Reject a pending support impersonation request",
      parameters: [
        {
          name: "requestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Support impersonation request", {
          $ref: "#/components/schemas/SupportSessionRequestReport",
        }),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
};
