import { createRoute, z } from "@hono/zod-openapi";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const visibility = z.enum(["private", "workspace", "marketplace"]);
export const PromptTemplateSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    name: z.string(),
    description: z.string().optional(),
    body: z.string(),
    tags: z.array(z.string()),
    visibility,
    createdBy: id,
    createdAt: time,
    updatedAt: time,
  })
  .openapi("PromptTemplate");
export const CreatePromptTemplateSchema = z
  .strictObject({
    workspaceId: id,
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(500).optional(),
    body: z.string().min(1).max(20_000),
    tags: z.array(z.string().min(1).max(40)).max(20).default([]),
    visibility: visibility.default("private"),
  })
  .openapi("CreatePromptTemplateRequest");
export const UpdatePromptTemplateSchema = z
  .strictObject({
    name: z.string().min(1).max(160).optional(),
    description: z.string().min(1).max(500).nullable().optional(),
    body: z.string().min(1).max(20_000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    visibility: visibility.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one prompt template field is required.",
  })
  .openapi("UpdatePromptTemplateRequest");
const permission = z.enum(["read", "write", "use", "run"]);
export const SharePromptTemplateSchema = z
  .strictObject({
    principalType: z.enum(["group", "service_account", "user"]),
    principalId: id,
    permissions: z.array(permission).min(1).max(4),
  })
  .openapi("SharePromptTemplateRequest");
export const PromptTemplateGrantSchema = z
  .strictObject({
    id,
    resourceType: z.string(),
    resourceId: id,
    principalType: z.enum(["group", "service_account", "user"]),
    principalId: id,
    permission,
  })
  .openapi("PromptTemplateGrant");
const catalogQuery = z.strictObject({
  workspaceId: id,
  query: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
const catalogResponse = z
  .strictObject({
    data: z.array(PromptTemplateSchema),
    meta: z
      .strictObject({
        limit: z.number().int(),
        offset: z.number().int(),
        total: z.number().int(),
        hasMore: z.boolean(),
      })
      .optional(),
  })
  .openapi("PromptTemplateCatalog");
const path = z.strictObject({ promptTemplateId: id });
const meta = { tags: ["Prompts"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const promptResponse = jsonResponse(
  "Prompt template",
  dataEnvelope(PromptTemplateSchema),
);
export const listPromptTemplatesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/prompt-templates",
  operationId: "prompts.listTemplates",
  summary: "List templates",
  request: { query: catalogQuery },
  responses: {
    200: jsonResponse("Prompt templates", catalogResponse),
    ...errors,
  },
});
export const createPromptTemplateRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/prompt-templates",
  operationId: "prompts.createTemplate",
  summary: "Create template",
  request: { body: body(CreatePromptTemplateSchema) },
  responses: { 201: promptResponse, ...errors },
});
export const listPromptMarketplaceRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/prompt-marketplace",
  operationId: "prompts.listMarketplace",
  summary: "List marketplace",
  request: { query: catalogQuery.omit({ limit: true, offset: true }) },
  responses: {
    200: jsonResponse(
      "Marketplace prompts",
      dataEnvelope(z.array(PromptTemplateSchema)),
    ),
    ...errors,
  },
});
export const getPromptTemplateRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/prompt-templates/{promptTemplateId}",
  operationId: "prompts.getTemplate",
  summary: "Get template",
  request: { params: path },
  responses: { 200: promptResponse, ...errors },
});
export const updatePromptTemplateRoute = createRoute({
  ...meta,
  method: "patch",
  path: "/api/v1/prompt-templates/{promptTemplateId}",
  operationId: "prompts.updateTemplate",
  summary: "Update template",
  request: { params: path, body: body(UpdatePromptTemplateSchema) },
  responses: { 200: promptResponse, ...errors },
});
export const deletePromptTemplateRoute = createRoute({
  ...meta,
  method: "delete",
  path: "/api/v1/prompt-templates/{promptTemplateId}",
  operationId: "prompts.deleteTemplate",
  summary: "Delete template",
  request: { params: path },
  responses: { 200: promptResponse, ...errors },
});
export const listPromptTemplateSharesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/prompt-templates/{promptTemplateId}/shares",
  operationId: "prompts.listShares",
  summary: "List shares",
  request: { params: path },
  responses: {
    200: jsonResponse(
      "Prompt shares",
      dataEnvelope(z.array(PromptTemplateGrantSchema)),
    ),
    ...errors,
  },
});
export const sharePromptTemplateRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/prompt-templates/{promptTemplateId}/shares",
  operationId: "prompts.shareTemplate",
  summary: "Share template",
  request: { params: path, body: body(SharePromptTemplateSchema) },
  responses: {
    201: jsonResponse(
      "Prompt shares",
      dataEnvelope(z.array(PromptTemplateGrantSchema)),
    ),
    ...errors,
  },
});
export const promptRoutes = [
  listPromptTemplatesRoute,
  createPromptTemplateRoute,
  listPromptMarketplaceRoute,
  getPromptTemplateRoute,
  updatePromptTemplateRoute,
  deletePromptTemplateRoute,
  listPromptTemplateSharesRoute,
  sharePromptTemplateRoute,
] as const;
