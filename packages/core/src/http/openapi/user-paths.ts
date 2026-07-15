import { errorResponse, jsonContent, success } from "./helpers";

const directorySyncRequestSchema = {
  type: "object",
  required: ["source"],
  additionalProperties: false,
  properties: {
    allowAdminUserDisable: { type: "boolean" },
    confirmApply: { type: "string", enum: ["apply-directory-sync"] },
    disableMissingUsers: { type: "boolean" },
    dryRun: { type: "boolean", default: true },
    groupMemberships: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        required: ["groupId", "presentUserIds"],
        additionalProperties: false,
        properties: {
          groupId: { type: "string", minLength: 1, maxLength: 120 },
          presentUserIds: {
            type: "array",
            maxItems: 10000,
            items: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    maxMembershipRemovals: { type: "integer", minimum: 0, maximum: 10000 },
    maxUserDisables: { type: "integer", minimum: 0, maximum: 1000 },
    presentUserEmails: {
      type: "array",
      maxItems: 10000,
      items: { type: "string", format: "email", maxLength: 320 },
    },
    presentUserIds: {
      type: "array",
      maxItems: 10000,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
    preserveAdminUsers: { type: "boolean", default: true },
    reason: { type: "string", minLength: 1, maxLength: 500 },
    removeMissingGroupMembers: { type: "boolean" },
    source: {
      type: "string",
      enum: ["active-directory", "ldap", "manual", "oidc", "saml", "scim"],
    },
  },
} as const;

const directorySyncUserDisablePlanSchema = {
  type: "object",
  required: ["count", "skippedAdminUserIds", "skippedSelfUserIds", "userIds"],
  properties: {
    count: { type: "integer", minimum: 0 },
    skippedAdminUserIds: { type: "array", items: { type: "string" } },
    skippedSelfUserIds: { type: "array", items: { type: "string" } },
    userIds: { type: "array", items: { type: "string" } },
  },
} as const;

const directorySyncMembershipRemovalPlanSchema = {
  type: "object",
  required: ["count", "groups", "skippedSelfUserIds"],
  properties: {
    count: { type: "integer", minimum: 0 },
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["count", "groupId", "userIds"],
        properties: {
          count: { type: "integer", minimum: 0 },
          groupId: { type: "string" },
          userIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    skippedSelfUserIds: { type: "array", items: { type: "string" } },
  },
} as const;

const directorySyncResultSchema = {
  type: "object",
  required: [
    "changes",
    "generatedAt",
    "limits",
    "mode",
    "orgId",
    "redaction",
    "requested",
    "schema",
    "source",
    "status",
    "warnings",
  ],
  properties: {
    changes: {
      type: "object",
      required: ["membershipRemovals", "userDisables"],
      properties: {
        membershipRemovals: directorySyncMembershipRemovalPlanSchema,
        userDisables: directorySyncUserDisablePlanSchema,
      },
    },
    generatedAt: { type: "string", format: "date-time" },
    limits: {
      type: "object",
      required: ["maxMembershipRemovals", "maxUserDisables"],
      properties: {
        maxMembershipRemovals: { type: "integer", minimum: 0 },
        maxUserDisables: { type: "integer", minimum: 0 },
      },
    },
    mode: { type: "string", enum: ["apply", "preview"] },
    orgId: { type: "string" },
    redaction: {
      type: "object",
      required: [
        "externalGroupNamesReturned",
        "externalSubjectIdsReturned",
        "rawDirectoryPayloadReturned",
        "userEmailsReturned",
        "userNamesReturned",
      ],
      properties: {
        externalGroupNamesReturned: { type: "boolean", enum: [false] },
        externalSubjectIdsReturned: { type: "boolean", enum: [false] },
        rawDirectoryPayloadReturned: { type: "boolean", enum: [false] },
        userEmailsReturned: { type: "boolean", enum: [false] },
        userNamesReturned: { type: "boolean", enum: [false] },
      },
    },
    requested: {
      type: "object",
      required: [
        "disableMissingUsers",
        "preserveAdminUsers",
        "removeMissingGroupMembers",
      ],
      properties: {
        disableMissingUsers: { type: "boolean" },
        preserveAdminUsers: { type: "boolean" },
        removeMissingGroupMembers: { type: "boolean" },
      },
    },
    schema: { type: "string", enum: ["romeo.directory-sync.v1"] },
    source: {
      type: "string",
      enum: ["active-directory", "ldap", "manual", "oidc", "saml", "scim"],
    },
    status: { type: "string", enum: ["applied", "preview"] },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export const userPaths = {
  "/admin/directory-sync": {
    post: {
      summary:
        "Preview or apply destructive directory lifecycle sync changes with redacted output",
      requestBody: {
        required: true,
        content: jsonContent(directorySyncRequestSchema),
      },
      responses: {
        200: success("Directory sync result", directorySyncResultSchema),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/users": {
    get: {
      summary: "List organization users",
      responses: {
        200: success("Users", {
          type: "array",
          items: { $ref: "#/components/schemas/User" },
        }),
        403: errorResponse,
      },
    },
  },
  "/users/{userId}/disable": {
    post: {
      summary: "Disable a user and revoke user credentials",
      parameters: [
        {
          name: "userId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("User", { $ref: "#/components/schemas/User" }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/users/{userId}/role": {
    patch: {
      summary: "Promote or demote a local or SSO-provisioned user role",
      parameters: [
        {
          name: "userId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateUserRoleRequest" },
          },
        },
      },
      responses: {
        200: success("User", { $ref: "#/components/schemas/User" }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/users/{userId}/local-password": {
    post: {
      summary: "Set or reset a user local password for SSO fallback",
      parameters: [
        {
          name: "userId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/AdminSetLocalPasswordRequest",
            },
          },
        },
      },
      responses: {
        200: success("Local auth status", {
          $ref: "#/components/schemas/LocalAuthStatus",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
