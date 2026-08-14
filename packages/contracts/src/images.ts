import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  idempotentJsonResponse,
  optionalIdempotencyHeaders,
  standardErrorResponses,
} from "./common";
import { FileObjectSchema } from "./files";

const identifier = z.string().trim().min(1).max(300);
const imageSize = z.enum(["1024x1024", "1024x1536", "1536x1024"]);

export const GenerateImagesSchema = z
  .strictObject({
    workspaceId: identifier,
    modelId: identifier,
    prompt: z.string().trim().min(1).max(8_000),
    count: z.number().int().min(1).max(4).default(1),
    size: imageSize.default("1024x1024"),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .openapi("GenerateImagesRequest");

export const GeneratedImageArtifactSchema = z
  .strictObject({
    id: identifier,
    file: FileObjectSchema,
    revisedPrompt: z.string().optional(),
  })
  .openapi("GeneratedImageArtifact");

export const generateImagesRoute = createRoute({
  tags: ["Images"],
  security: authenticationSecurity,
  method: "post",
  path: "/api/v1/images/generations",
  operationId: "images.generate",
  summary: "Generate governed image artifacts",
  request: {
    headers: optionalIdempotencyHeaders,
    body: {
      required: true,
      content: { "application/json": { schema: GenerateImagesSchema } },
    },
  },
  responses: {
    201: idempotentJsonResponse(
      "Generated images",
      dataEnvelope(z.array(GeneratedImageArtifactSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const imageRoutes = [generateImagesRoute] as const;
