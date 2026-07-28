import { scopeValues } from "@romeo/auth";
import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const scope = z.enum(scopeValues);

export const DeviceAuthorizationSchema = z
  .strictObject({
    id,
    orgId: id,
    userId: id,
    name: z.string(),
    scopes: z.array(scope),
    accessApiKeyId: id,
    expiresAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRefreshedAt: timestamp.optional(),
    revokedAt: timestamp.optional(),
  })
  .openapi("DeviceAuthorization", {
    description:
      "Public device authorization metadata. The stored refresh-token hash is never returned.",
  });

export const CreatedDeviceAuthorizationSchema = z
  .strictObject({
    authorization: DeviceAuthorizationSchema,
    accessToken: z.string().regex(/^rmk_[a-f0-9]{48}$/),
    refreshToken: z.string().regex(/^rmr_[a-f0-9]{48}$/),
  })
  .openapi("CreatedDeviceAuthorization");

export const CreateDeviceAuthorizationSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    scopes: z.array(scope).min(1).max(32),
    ttlDays: z.number().int().min(1).max(365).optional(),
  })
  .openapi("CreateDeviceAuthorizationRequest");

export const RefreshDeviceAuthorizationSchema = z
  .strictObject({
    refreshToken: z.string().regex(/^rmr_[a-f0-9]{48}$/),
  })
  .openapi("RefreshDeviceAuthorizationRequest");

const metadata = {
  tags: ["Device authorizations"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;

export const listDeviceAuthorizationsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/device-authorizations",
  operationId: "deviceAuthorizations.list",
  summary: "List device authorizations for the current user",
  responses: {
    200: jsonResponse(
      "Device authorizations",
      dataEnvelope(z.array(DeviceAuthorizationSchema)),
    ),
    ...errors,
  },
});

export const createDeviceAuthorizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/device-authorizations",
  operationId: "deviceAuthorizations.create",
  summary: "Create a refreshable device authorization",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateDeviceAuthorizationSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(
      "Created device authorization",
      dataEnvelope(CreatedDeviceAuthorizationSchema),
    ),
    ...errors,
  },
});

export const refreshDeviceAuthorizationRoute = createRoute({
  method: "post",
  path: "/api/v1/device-authorizations/refresh",
  operationId: "deviceAuthorizations.refresh",
  tags: ["Device authorizations"],
  security: [],
  summary: "Rotate a device authorization with a refresh token",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: RefreshDeviceAuthorizationSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Refreshed device authorization",
      dataEnvelope(CreatedDeviceAuthorizationSchema),
    ),
    400: errors[400],
    403: errors[403],
    500: errors[500],
  },
});

export const revokeDeviceAuthorizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/device-authorizations/{deviceAuthorizationId}/revoke",
  operationId: "deviceAuthorizations.revoke",
  summary: "Revoke a device authorization",
  request: {
    params: z.strictObject({ deviceAuthorizationId: id }),
  },
  responses: {
    200: jsonResponse(
      "Device authorization",
      dataEnvelope(DeviceAuthorizationSchema),
    ),
    ...errors,
  },
});

export const deviceAuthorizationRoutes = [
  listDeviceAuthorizationsRoute,
  createDeviceAuthorizationRoute,
  refreshDeviceAuthorizationRoute,
  revokeDeviceAuthorizationRoute,
] as const;
