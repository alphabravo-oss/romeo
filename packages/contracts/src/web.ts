import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const provider = z.enum(["brave", "searxng", "tavily"]);
const domainList = z.array(z.string().trim().min(1).max(253)).max(100);

export const WebSearchProviderHealthSchema = z
  .strictObject({
    status: z.enum(["unknown", "healthy", "degraded"]),
    lastCheckedAt: timestamp.optional(),
    latencyMs: z.number().nonnegative().optional(),
    lastErrorCode: z.string().max(200).optional(),
  })
  .openapi("WebSearchProviderHealth");

export const WebSearchConfigurationSchema = z
  .strictObject({
    enabled: z.boolean(),
    provider,
    endpointUrl: z.url(),
    credentialConfigured: z.boolean(),
    allowedDomains: domainList,
    blockedDomains: domainList,
    maxResults: z.number().int().min(1).max(10),
    freshnessMaxAgeDays: z.union([z.number().int().min(1).max(3650), z.null()]),
    unknownPublicationDatePolicy: z.enum(["allow", "exclude"]),
    unreachableUrlPolicy: z.enum(["fail", "skip"]),
    health: WebSearchProviderHealthSchema,
  })
  .openapi("WebSearchConfiguration");

export const WebSearchResultSchema = z
  .strictObject({
    id: identifier,
    title: z.string().min(1).max(2_000),
    url: z.url(),
    snippet: z.string().max(30_000),
    accessedAt: timestamp,
    publishedAt: timestamp.optional(),
    sourceType: z.enum(["url", "web_search"]),
    provider: provider.optional(),
  })
  .openapi("WebSearchResult");

export const WebUrlIngestResultSchema = WebSearchResultSchema.extend({
  content: z.string().max(30_000),
  fileId: identifier.optional(),
}).openapi("WebUrlIngestResult");

export const UpdateWebSearchConfigurationSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    provider: provider.optional(),
    endpointUrl: z.url().optional(),
    credentialRef: z.union([z.string().min(1).max(500), z.null()]).optional(),
    allowedDomains: domainList.optional(),
    blockedDomains: domainList.optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
    freshnessMaxAgeDays: z
      .union([z.number().int().min(1).max(3650), z.null()])
      .optional(),
    unknownPublicationDatePolicy: z.enum(["allow", "exclude"]).optional(),
    unreachableUrlPolicy: z.enum(["fail", "skip"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one web-search field is required.",
  })
  .openapi("UpdateWebSearchConfigurationRequest");

export const WebSearchRequestSchema = z
  .strictObject({ query: z.string().trim().min(1).max(4_000) })
  .openapi("WebSearchRequest");

export const WebUrlIngestSchema = z
  .strictObject({
    urls: z.array(z.url()).min(1).max(5),
    workspaceId: identifier.optional(),
    saveToLibrary: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.saveToLibrary === true && value.workspaceId === undefined) {
      context.addIssue({
        code: "custom",
        message: "workspaceId is required when saveToLibrary is true.",
        path: ["workspaceId"],
      });
    }
  })
  .openapi("WebUrlIngestRequest");

const metadata = { tags: ["Web"], security: authenticationSecurity };
const errors = standardErrorResponses;

export const getWebSearchConfigurationRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/web-search",
  operationId: "web.getConfiguration",
  summary: "Read governed web-search configuration",
  responses: {
    200: jsonResponse(
      "Web-search configuration",
      dataEnvelope(WebSearchConfigurationSchema),
    ),
    ...errors,
  },
});

export const updateWebSearchConfigurationRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/web-search",
  operationId: "web.updateConfiguration",
  summary: "Update governed web-search configuration",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateWebSearchConfigurationSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated web-search configuration",
      dataEnvelope(WebSearchConfigurationSchema),
    ),
    ...errors,
  },
});

export const searchWebRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/web-search",
  operationId: "web.search",
  summary: "Search the web through organization policy",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: WebSearchRequestSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Governed search results",
      dataEnvelope(z.array(WebSearchResultSchema)),
    ),
    ...errors,
  },
});

export const ingestWebUrlsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/web/ingest",
  operationId: "web.ingestUrls",
  summary: "Fetch governed webpage context",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: WebUrlIngestSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Fetched webpage context",
      dataEnvelope(z.array(WebUrlIngestResultSchema)),
    ),
    ...errors,
  },
});

export const webRoutes = [
  getWebSearchConfigurationRoute,
  updateWebSearchConfigurationRoute,
  searchWebRoute,
  ingestWebUrlsRoute,
] as const;
