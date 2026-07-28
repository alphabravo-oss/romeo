import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const AuthSubjectSchema = z
  .strictObject({
    id: z.string(),
    type: z.enum(["user", "service_account"]),
    email: z.email().optional(),
    name: z.string().optional(),
    apiKeyId: z.string().optional(),
    sessionId: z.string().optional(),
    supportSession: z
      .strictObject({
        adminUserId: z.string(),
        createdAuditLogId: z.string(),
      })
      .optional(),
    orgId: z.string(),
    workspaceIds: z.array(z.string()),
    groupIds: z.array(z.string()),
    scopes: z.array(z.string()),
    isAdmin: z.boolean().optional(),
    adminRole: z.enum(["org_admin", "global_admin"]).optional(),
  })
  .openapi("AuthSubject");

export const UserSchema = z
  .strictObject({
    id: z.string(),
    orgId: z.string(),
    email: z.email(),
    name: z.string(),
    role: z.enum(["user", "org_admin", "global_admin"]).optional(),
    disabledAt: z.iso.datetime().optional(),
  })
  .openapi("User");

export const OrganizationSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .openapi("Organization");

export const WorkspaceSchema = z
  .strictObject({
    id: z.string(),
    orgId: z.string(),
    name: z.string(),
    slug: z.string(),
    archivedAt: z.iso.datetime().optional(),
  })
  .openapi("Workspace");

export const BootstrapDeploymentSchema = z
  .strictObject({ tenancyMode: z.enum(["single", "multi"]) })
  .openapi("BootstrapDeployment");

export const BootstrapResponseSchema = z
  .strictObject({
    subject: AuthSubjectSchema,
    user: UserSchema.optional(),
    deployment: BootstrapDeploymentSchema,
    organizations: z.array(OrganizationSchema),
    workspaces: z.array(WorkspaceSchema),
  })
  .openapi("BootstrapResponse");

export const UpdateMyProfileSchema = z
  .strictObject({
    email: z.email().max(320).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine((value) => value.email !== undefined || value.name !== undefined, {
    message: "At least one profile field is required.",
  })
  .openapi("UpdateMyProfileRequest");

export const UserResponseSchema =
  dataEnvelope(UserSchema).openapi("UserResponse");

export const getCurrentPrincipalRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  operationId: "identity.getCurrentPrincipal",
  tags: ["Identity"],
  summary: "Bootstrap the current principal",
  description:
    "Returns the authenticated subject, deployment tenancy mode, profile, organizations, and workspaces needed to initialize the application.",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Application bootstrap", BootstrapResponseSchema),
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});

export const updateCurrentProfileRoute = createRoute({
  method: "patch",
  path: "/api/v1/me",
  operationId: "identity.updateCurrentProfile",
  tags: ["Identity"],
  summary: "Update the current user's profile",
  description: "Updates one or more self-service profile fields.",
  security: authenticationSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: UpdateMyProfileSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated user profile", UserResponseSchema),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    409: standardErrorResponses[409],
    500: standardErrorResponses[500],
  },
});
