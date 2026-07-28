import { createRoute, z } from "@hono/zod-openapi";

const scimSecurity = [{ bearerAuth: [] }];
const scimSchemaUrn = z.string().min(1);
const identifier = z.string().trim().min(1).max(200);

const ScimEmailInputSchema = z.looseObject({
  value: z.string().min(1).max(320).optional(),
  primary: z.boolean().optional(),
  type: z.string().max(40).optional(),
});
const ScimNameInputSchema = z.looseObject({
  formatted: z.string().min(1).max(200).optional(),
  givenName: z.string().min(1).max(100).optional(),
  familyName: z.string().min(1).max(100).optional(),
});
const ScimMemberInputSchema = z.looseObject({
  value: z.string().min(1).max(120).optional(),
  display: z.string().max(200).optional(),
});

/** SCIM request resources are intentionally extensible per RFC 7643. */
export const ScimUserRequestSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn).max(10).optional(),
    externalId: z.string().max(200).optional(),
    userName: z.string().min(1).max(320).optional(),
    displayName: z.string().min(1).max(200).optional(),
    name: ScimNameInputSchema.optional(),
    emails: z.array(ScimEmailInputSchema).max(10).optional(),
    active: z.boolean().optional(),
  })
  .openapi("ScimUserRequest");

/** SCIM request resources are intentionally extensible per RFC 7643. */
export const ScimGroupRequestSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn).max(10).optional(),
    externalId: z.string().max(200).optional(),
    displayName: z.string().min(1).max(160).optional(),
    members: z.array(ScimMemberInputSchema).max(1000).optional(),
  })
  .openapi("ScimGroupRequest");

export const ScimPatchRequestSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn).max(10).optional(),
    Operations: z
      .array(
        z.looseObject({
          op: z.string().min(1).max(20).optional(),
          path: z.string().min(1).max(500).optional(),
          value: z.unknown().optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .openapi("ScimPatchOp");

const ScimMetaSchema = z.looseObject({
  resourceType: z.string(),
  location: z.string(),
  created: z.iso.datetime().optional(),
});
export const ScimUserSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn),
    id: identifier,
    userName: z.string(),
    name: z.looseObject({ formatted: z.string() }),
    displayName: z.string(),
    active: z.boolean(),
    emails: z.array(
      z.looseObject({
        value: z.string(),
        primary: z.boolean(),
        type: z.string(),
      }),
    ),
    groups: z.array(
      z.looseObject({ value: identifier, display: z.string().optional() }),
    ),
    meta: ScimMetaSchema,
  })
  .openapi("ScimUser");
export const ScimGroupSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn),
    id: identifier,
    displayName: z.string(),
    members: z.array(
      z.looseObject({ value: identifier, display: z.string().optional() }),
    ),
    meta: ScimMetaSchema,
  })
  .openapi("ScimGroup");

export const ScimListResponseSchema = z
  .looseObject({
    schemas: z.array(scimSchemaUrn),
    totalResults: z.number().int().nonnegative(),
    startIndex: z.number().int().min(1),
    itemsPerPage: z.number().int().nonnegative(),
    Resources: z.array(z.looseObject({})),
  })
  .openapi("ScimListResponse");
export const ScimDiscoveryResourceSchema = z
  .looseObject({ schemas: z.array(scimSchemaUrn) })
  .openapi("ScimDiscoveryResource");
export const ScimErrorSchema = z
  .strictObject({
    schemas: z.array(scimSchemaUrn),
    detail: z.string(),
    status: z.string(),
    scimType: z.string().optional(),
  })
  .openapi("ScimError");

export const ScimListQuerySchema = z.strictObject({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().min(1).optional(),
  count: z.coerce.number().int().min(0).max(200).optional(),
});

const scimContent = <T extends z.ZodType>(schema: T) => ({
  "application/scim+json": { schema },
});
const scimResponse = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: scimContent(schema),
});
const scimBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: scimContent(schema),
});
const scimErrors = {
  400: scimResponse("Invalid SCIM request", ScimErrorSchema),
  403: scimResponse("SCIM access denied", ScimErrorSchema),
  404: scimResponse("SCIM resource not found", ScimErrorSchema),
  409: scimResponse("SCIM resource conflict", ScimErrorSchema),
};
const metadata = { tags: ["SCIM"], security: scimSecurity };
const userParams = z.strictObject({ userId: identifier });
const groupParams = z.strictObject({ groupId: identifier });

export const getScimServiceProviderConfigRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/ServiceProviderConfig",
  operationId: "scim.getServiceProviderConfig",
  summary: "Get SCIM service-provider configuration",
  responses: {
    200: scimResponse(
      "SCIM service-provider configuration",
      ScimDiscoveryResourceSchema,
    ),
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const listScimSchemasRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/Schemas",
  operationId: "scim.listSchemas",
  summary: "List SCIM schemas",
  responses: {
    200: scimResponse("SCIM schemas", ScimListResponseSchema),
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const listScimResourceTypesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/ResourceTypes",
  operationId: "scim.listResourceTypes",
  summary: "List SCIM resource types",
  responses: {
    200: scimResponse("SCIM resource types", ScimListResponseSchema),
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const listScimUsersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/Users",
  operationId: "scim.listUsers",
  summary: "List SCIM users",
  request: { query: ScimListQuerySchema },
  responses: {
    200: scimResponse("SCIM users", ScimListResponseSchema),
    ...scimErrors,
  },
});
export const createScimUserRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/scim/v2/Users",
  operationId: "scim.createUser",
  summary: "Create a SCIM user",
  request: { body: scimBody(ScimUserRequestSchema) },
  responses: { 201: scimResponse("SCIM user", ScimUserSchema), ...scimErrors },
});
export const getScimUserRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/Users/{userId}",
  operationId: "scim.getUser",
  summary: "Get a SCIM user",
  request: { params: userParams },
  responses: {
    200: scimResponse("SCIM user", ScimUserSchema),
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const replaceScimUserRoute = createRoute({
  ...metadata,
  method: "put",
  path: "/api/v1/scim/v2/Users/{userId}",
  operationId: "scim.replaceUser",
  summary: "Replace a SCIM user",
  request: { params: userParams, body: scimBody(ScimUserRequestSchema) },
  responses: { 200: scimResponse("SCIM user", ScimUserSchema), ...scimErrors },
});
export const patchScimUserRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/scim/v2/Users/{userId}",
  operationId: "scim.patchUser",
  summary: "Patch a SCIM user",
  request: { params: userParams, body: scimBody(ScimPatchRequestSchema) },
  responses: { 200: scimResponse("SCIM user", ScimUserSchema), ...scimErrors },
});
export const deleteScimUserRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/scim/v2/Users/{userId}",
  operationId: "scim.deleteUser",
  summary: "Deactivate a SCIM user",
  request: { params: userParams },
  responses: {
    204: { description: "SCIM user deactivated" },
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const listScimGroupsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/Groups",
  operationId: "scim.listGroups",
  summary: "List SCIM groups",
  request: { query: ScimListQuerySchema },
  responses: {
    200: scimResponse("SCIM groups", ScimListResponseSchema),
    ...scimErrors,
  },
});
export const createScimGroupRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/scim/v2/Groups",
  operationId: "scim.createGroup",
  summary: "Create a SCIM group",
  request: { body: scimBody(ScimGroupRequestSchema) },
  responses: {
    201: scimResponse("SCIM group", ScimGroupSchema),
    ...scimErrors,
  },
});
export const getScimGroupRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/scim/v2/Groups/{groupId}",
  operationId: "scim.getGroup",
  summary: "Get a SCIM group",
  request: { params: groupParams },
  responses: {
    200: scimResponse("SCIM group", ScimGroupSchema),
    403: scimErrors[403],
    404: scimErrors[404],
  },
});
export const replaceScimGroupRoute = createRoute({
  ...metadata,
  method: "put",
  path: "/api/v1/scim/v2/Groups/{groupId}",
  operationId: "scim.replaceGroup",
  summary: "Replace a SCIM group",
  request: { params: groupParams, body: scimBody(ScimGroupRequestSchema) },
  responses: {
    200: scimResponse("SCIM group", ScimGroupSchema),
    ...scimErrors,
  },
});
export const patchScimGroupRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/scim/v2/Groups/{groupId}",
  operationId: "scim.patchGroup",
  summary: "Patch a SCIM group",
  request: { params: groupParams, body: scimBody(ScimPatchRequestSchema) },
  responses: {
    200: scimResponse("SCIM group", ScimGroupSchema),
    ...scimErrors,
  },
});
export const deleteScimGroupRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/scim/v2/Groups/{groupId}",
  operationId: "scim.deleteGroup",
  summary: "Delete a SCIM group and revoke group grants",
  request: { params: groupParams },
  responses: {
    204: { description: "SCIM group deleted" },
    403: scimErrors[403],
    404: scimErrors[404],
  },
});

export const scimRoutes = [
  getScimServiceProviderConfigRoute,
  listScimSchemasRoute,
  listScimResourceTypesRoute,
  listScimUsersRoute,
  createScimUserRoute,
  getScimUserRoute,
  replaceScimUserRoute,
  patchScimUserRoute,
  deleteScimUserRoute,
  listScimGroupsRoute,
  createScimGroupRoute,
  getScimGroupRoute,
  replaceScimGroupRoute,
  patchScimGroupRoute,
  deleteScimGroupRoute,
] as const;
