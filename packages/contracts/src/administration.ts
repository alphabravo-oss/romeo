import { scopeValues } from "@romeo/auth";
import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const scope = z.enum(scopeValues);
const userRole = z.enum(["user", "org_admin", "global_admin"]);

export const AdminUserSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    email: z.email(),
    name: z.string().min(1),
    role: userRole,
    disabledAt: timestamp.optional(),
  })
  .openapi("AdminUser");
export const GroupSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    name: z.string().min(1),
    slug: z.string().min(1),
    createdAt: timestamp,
  })
  .openapi("Group");
export const GroupMemberSchema = z
  .strictObject({
    groupId: identifier,
    userId: identifier,
    orgId: identifier,
    createdAt: timestamp,
  })
  .openapi("GroupMember");
export const ApiKeySummarySchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    userId: identifier.optional(),
    serviceAccountId: identifier.optional(),
    name: z.string().min(1),
    scopes: z.array(scope),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
  })
  .openapi("ApiKeySummary");
export const CreatedApiKeySchema = z
  .strictObject({
    apiKey: ApiKeySummarySchema,
    token: z.string().min(1),
  })
  .openapi("CreatedApiKey");
export const ServiceAccountSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    name: z.string().min(1),
    scopes: z.array(scope),
    createdBy: identifier,
    disabledAt: timestamp.optional(),
    createdAt: timestamp,
  })
  .openapi("ServiceAccount");
export const BulkActionResultSchema = z
  .strictObject({
    results: z.array(
      z.strictObject({
        id: identifier,
        status: z.enum(["success", "failure"]),
        error: z.string().optional(),
      }),
    ),
  })
  .openapi("BulkActionResult");

export const LocalMfaFactorSummarySchema = z
  .strictObject({
    id: identifier,
    type: z.enum(["recovery_codes", "totp"]),
    name: z.string(),
    status: z.enum(["pending", "active", "disabled"]),
    createdAt: timestamp,
    confirmedAt: timestamp.optional(),
    disabledAt: timestamp.optional(),
    lastUsedAt: timestamp.optional(),
    recoveryCodeRemainingCount: z.number().int().nonnegative().optional(),
  })
  .openapi("LocalMfaFactorSummary");
export const LocalAuthStatusSchema = z
  .strictObject({
    factors: z.array(LocalMfaFactorSummarySchema),
    hasPassword: z.boolean(),
    mfaEnabled: z.boolean(),
    role: userRole,
  })
  .openapi("LocalAuthStatus");

const directorySource = z.enum([
  "active-directory",
  "ldap",
  "manual",
  "oidc",
  "saml",
  "scim",
]);
export const DirectorySyncRequestSchema = z
  .strictObject({
    allowAdminUserDisable: z.boolean().optional(),
    confirmApply: z.literal("apply-directory-sync").optional(),
    disableMissingUsers: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    groupMemberships: z
      .array(
        z.strictObject({
          groupId: identifier,
          presentUserIds: z.array(identifier).max(10_000),
        }),
      )
      .max(500)
      .optional(),
    maxMembershipRemovals: z.number().int().min(0).max(10_000).optional(),
    maxUserDisables: z.number().int().min(0).max(1_000).optional(),
    presentUserEmails: z.array(z.email()).max(10_000).optional(),
    presentUserIds: z.array(identifier).max(10_000).optional(),
    preserveAdminUsers: z.boolean().optional(),
    reason: z.string().min(1).max(500).optional(),
    removeMissingGroupMembers: z.boolean().optional(),
    source: directorySource,
  })
  .openapi("DirectorySyncRequest");
const userDisablePlan = z.strictObject({
  count: z.number().int().nonnegative(),
  skippedAdminUserIds: z.array(identifier),
  skippedSelfUserIds: z.array(identifier),
  userIds: z.array(identifier),
});
const membershipRemovalPlan = z.strictObject({
  count: z.number().int().nonnegative(),
  groups: z.array(
    z.strictObject({
      count: z.number().int().nonnegative(),
      groupId: identifier,
      userIds: z.array(identifier),
    }),
  ),
  skippedSelfUserIds: z.array(identifier),
});
export const DirectorySyncResultSchema = z
  .strictObject({
    schema: z.literal("romeo.directory-sync.v1"),
    generatedAt: timestamp,
    orgId: identifier,
    source: directorySource,
    mode: z.enum(["apply", "preview"]),
    status: z.enum(["applied", "preview"]),
    warnings: z.array(z.string()),
    changes: z.strictObject({
      membershipRemovals: membershipRemovalPlan,
      userDisables: userDisablePlan,
    }),
    limits: z.strictObject({
      maxMembershipRemovals: z.number().int().nonnegative(),
      maxUserDisables: z.number().int().nonnegative(),
    }),
    requested: z.strictObject({
      disableMissingUsers: z.boolean(),
      preserveAdminUsers: z.boolean(),
      removeMissingGroupMembers: z.boolean(),
    }),
    redaction: z.strictObject({
      externalGroupNamesReturned: z.literal(false),
      externalSubjectIdsReturned: z.literal(false),
      rawDirectoryPayloadReturned: z.literal(false),
      userEmailsReturned: z.literal(false),
      userNamesReturned: z.literal(false),
    }),
  })
  .openapi("DirectorySyncResult");

export const CreateGroupSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160),
    slug: z.string().trim().min(1).max(80).optional(),
  })
  .openapi("CreateGroupRequest");
export const AddGroupMemberSchema = z
  .strictObject({ userId: identifier })
  .openapi("AddGroupMemberRequest");
export const UpdateUserRoleSchema = z
  .strictObject({ confirmUserId: identifier, role: userRole })
  .openapi("UpdateUserRoleRequest");
export const AdminSetLocalPasswordSchema = z
  .strictObject({
    confirmUserId: identifier,
    newPassword: z.string().min(12).max(256),
  })
  .openapi("AdminSetLocalPasswordRequest");
export const CreateApiKeySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    scopes: z.array(scope).min(1).max(scopeValues.length),
  })
  .openapi("CreateApiKeyRequest");
export const CreateServiceAccountSchema = CreateApiKeySchema.openapi(
  "CreateServiceAccountRequest",
);
export const BulkRevokeApiKeysSchema = z
  .strictObject({ apiKeyIds: z.array(identifier).min(1).max(200) })
  .openapi("BulkRevokeApiKeysRequest");
export const BulkDisableServiceAccountsSchema = z
  .strictObject({ serviceAccountIds: z.array(identifier).min(1).max(200) })
  .openapi("BulkDisableServiceAccountsRequest");

const metadata = { tags: ["Administration"], security: authenticationSecurity };
const errors = standardErrorResponses;
const userPath = z.strictObject({ userId: identifier });
const groupPath = z.strictObject({ groupId: identifier });
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const listUsersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/users",
  operationId: "administration.listUsers",
  summary: "List organization users",
  responses: {
    200: jsonResponse("Users", dataEnvelope(z.array(AdminUserSchema))),
    ...errors,
  },
});
export const disableUserRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/users/{userId}/disable",
  operationId: "administration.disableUser",
  summary: "Disable a user",
  request: { params: userPath },
  responses: {
    200: jsonResponse("Disabled user", dataEnvelope(AdminUserSchema)),
    ...errors,
  },
});
export const updateUserRoleRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/users/{userId}/role",
  operationId: "administration.updateUserRole",
  summary: "Update a user role",
  request: { params: userPath, body: body(UpdateUserRoleSchema) },
  responses: {
    200: jsonResponse("Updated user", dataEnvelope(AdminUserSchema)),
    ...errors,
  },
});
export const setUserLocalPasswordRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/users/{userId}/local-password",
  operationId: "administration.setUserLocalPassword",
  summary: "Set a user's local password",
  request: { params: userPath, body: body(AdminSetLocalPasswordSchema) },
  responses: {
    200: jsonResponse(
      "Local authentication status",
      dataEnvelope(LocalAuthStatusSchema),
    ),
    ...errors,
  },
});
export const directorySyncRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/directory-sync",
  operationId: "administration.directorySync",
  summary: "Preview or apply directory synchronization",
  request: { body: body(DirectorySyncRequestSchema) },
  responses: {
    200: jsonResponse(
      "Directory synchronization result",
      dataEnvelope(DirectorySyncResultSchema),
    ),
    ...errors,
  },
});

export const listGroupsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/groups",
  operationId: "administration.listGroups",
  summary: "List groups",
  responses: {
    200: jsonResponse("Groups", dataEnvelope(z.array(GroupSchema))),
    ...errors,
  },
});
export const createGroupRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/groups",
  operationId: "administration.createGroup",
  summary: "Create a group",
  request: { body: body(CreateGroupSchema) },
  responses: {
    201: jsonResponse("Created group", dataEnvelope(GroupSchema)),
    ...errors,
  },
});
export const listGroupMembersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/groups/{groupId}/members",
  operationId: "administration.listGroupMembers",
  summary: "List group members",
  request: { params: groupPath },
  responses: {
    200: jsonResponse(
      "Group members",
      dataEnvelope(z.array(GroupMemberSchema)),
    ),
    ...errors,
  },
});
export const addGroupMemberRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/groups/{groupId}/members",
  operationId: "administration.addGroupMember",
  summary: "Add a group member",
  request: { params: groupPath, body: body(AddGroupMemberSchema) },
  responses: {
    201: jsonResponse("Group member", dataEnvelope(GroupMemberSchema)),
    ...errors,
  },
});
export const removeGroupMemberRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/groups/{groupId}/members/{userId}",
  operationId: "administration.removeGroupMember",
  summary: "Remove a group member",
  request: {
    params: z.strictObject({ groupId: identifier, userId: identifier }),
  },
  responses: {
    200: jsonResponse("Removed group member", dataEnvelope(GroupMemberSchema)),
    ...errors,
  },
});

export const listApiKeysRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/api-keys",
  operationId: "administration.listApiKeys",
  summary: "List API keys",
  responses: {
    200: jsonResponse("API keys", dataEnvelope(z.array(ApiKeySummarySchema))),
    ...errors,
  },
});
export const createApiKeyRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/api-keys",
  operationId: "administration.createApiKey",
  summary: "Create an API key",
  request: { body: body(CreateApiKeySchema) },
  responses: {
    201: jsonResponse("Created API key", dataEnvelope(CreatedApiKeySchema)),
    ...errors,
  },
});
export const bulkRevokeApiKeysRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/api-keys/bulk-revoke",
  operationId: "administration.bulkRevokeApiKeys",
  summary: "Bulk revoke API keys",
  request: { body: body(BulkRevokeApiKeysSchema) },
  responses: {
    200: jsonResponse(
      "Bulk action result",
      dataEnvelope(BulkActionResultSchema),
    ),
    ...errors,
  },
});
export const revokeApiKeyRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/api-keys/{apiKeyId}/revoke",
  operationId: "administration.revokeApiKey",
  summary: "Revoke an API key",
  request: { params: z.strictObject({ apiKeyId: identifier }) },
  responses: {
    200: jsonResponse("Revoked API key", dataEnvelope(ApiKeySummarySchema)),
    ...errors,
  },
});

export const listServiceAccountsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/service-accounts",
  operationId: "administration.listServiceAccounts",
  summary: "List service accounts",
  responses: {
    200: jsonResponse(
      "Service accounts",
      dataEnvelope(z.array(ServiceAccountSchema)),
    ),
    ...errors,
  },
});
export const createServiceAccountRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/service-accounts",
  operationId: "administration.createServiceAccount",
  summary: "Create a service account",
  request: { body: body(CreateServiceAccountSchema) },
  responses: {
    201: jsonResponse(
      "Created service account",
      dataEnvelope(ServiceAccountSchema),
    ),
    ...errors,
  },
});
export const bulkDisableServiceAccountsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/service-accounts/bulk-disable",
  operationId: "administration.bulkDisableServiceAccounts",
  summary: "Bulk disable service accounts",
  request: { body: body(BulkDisableServiceAccountsSchema) },
  responses: {
    200: jsonResponse(
      "Bulk action result",
      dataEnvelope(BulkActionResultSchema),
    ),
    ...errors,
  },
});
export const createServiceAccountApiKeyRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/service-accounts/{serviceAccountId}/api-keys",
  operationId: "administration.createServiceAccountApiKey",
  summary: "Create a service-account API key",
  request: {
    params: z.strictObject({ serviceAccountId: identifier }),
    body: body(CreateApiKeySchema),
  },
  responses: {
    201: jsonResponse("Created API key", dataEnvelope(CreatedApiKeySchema)),
    ...errors,
  },
});
export const disableServiceAccountRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/service-accounts/{serviceAccountId}/disable",
  operationId: "administration.disableServiceAccount",
  summary: "Disable a service account",
  request: { params: z.strictObject({ serviceAccountId: identifier }) },
  responses: {
    200: jsonResponse(
      "Disabled service account",
      dataEnvelope(ServiceAccountSchema),
    ),
    ...errors,
  },
});
