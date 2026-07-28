import { createRoute, z } from "@hono/zod-openapi";

import { jsonResponse, standardErrorResponses } from "./common";

export const OpenApiDocumentSchema = z
  .object({
    openapi: z.string(),
    info: z
      .object({
        title: z.string(),
        version: z.string(),
        description: z.string().optional(),
      })
      .passthrough(),
    servers: z
      .array(
        z
          .object({
            url: z.string(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    paths: z.record(z.string(), z.unknown()),
    components: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type OpenApiDocumentResponse = z.infer<typeof OpenApiDocumentSchema>;

export const getOpenApiDocumentRoute = createRoute({
  method: "get",
  path: "/api/v1/openapi.json",
  operationId: "system.getOpenApiDocument",
  tags: ["System"],
  security: [],
  summary: "Get the Romeo OpenAPI document",
  responses: {
    200: jsonResponse("Romeo OpenAPI 3.1 document", OpenApiDocumentSchema),
    ...standardErrorResponses,
  },
});

export const getApiDocsRoute = createRoute({
  method: "get",
  path: "/api/v1/docs",
  operationId: "system.getApiDocs",
  tags: ["System"],
  security: [],
  summary: "Render local OpenAPI documentation",
  responses: {
    200: {
      description: "Self-contained HTML API documentation",
      content: { "text/html": { schema: z.string() } },
    },
    ...standardErrorResponses,
  },
});

export const openApiRoutes = [
  getOpenApiDocumentRoute,
  getApiDocsRoute,
] as const;
