import { createRoute, z } from "@hono/zod-openapi";

import {
  OpenAiChatCompletionRequestSchema,
  OpenAiChatCompletionResponseSchema,
  OpenAiEmbeddingRequestSchema,
  OpenAiEmbeddingResponseSchema,
  OpenAiModelListResponseSchema,
  OpenAiModelSchema,
  openAiModelParams,
} from "./openai-compatibility-schemas";

export type {
  OpenAiChatCompletionChoice,
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
  OpenAiChatMessageInput,
  OpenAiChatToolInput,
  OpenAiCompletionUsage,
  OpenAiEmbeddingRequest,
  OpenAiEmbeddingResponse,
  OpenAiToolCall,
} from "./openai-compatibility-schemas";
import {
  authenticationSecurity,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export * from "./openai-compatibility-schemas";

const metadata = {
  tags: ["OpenAI compatibility"],
  security: authenticationSecurity,
};
const modelListResponse = jsonResponse(
  "OpenAI-compatible model list",
  OpenAiModelListResponseSchema,
);
const modelResponse = jsonResponse(
  "OpenAI-compatible model",
  OpenAiModelSchema,
);
const completionResponse = {
  description: "OpenAI-compatible chat completion or event stream",
  content: {
    "application/json": { schema: OpenAiChatCompletionResponseSchema },
    "text/event-stream": { schema: z.string() },
  },
} as const;
const embeddingResponse = jsonResponse(
  "OpenAI-compatible embeddings",
  OpenAiEmbeddingResponseSchema,
);
const providerErrors = {
  ...standardErrorResponses,
  502: errorResponse,
  503: errorResponse,
};
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const listOpenAiModelsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/openai/models",
  operationId: "openAiCompatibility.listModels",
  summary: "List OpenAI-compatible models",
  responses: { 200: modelListResponse, ...standardErrorResponses },
});
export const retrieveOpenAiModelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/openai/models/{model}",
  operationId: "openAiCompatibility.retrieveModel",
  summary: "Retrieve an OpenAI-compatible model",
  request: { params: openAiModelParams },
  responses: { 200: modelResponse, ...standardErrorResponses },
});
export const listOpenAiModelsAliasRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/models",
  operationId: "openAiCompatibility.listModelsAlias",
  summary: "List OpenAI-compatible models through the legacy API alias",
  servers: [{ url: "/" }],
  responses: { 200: modelListResponse, ...standardErrorResponses },
});
export const retrieveOpenAiModelAliasRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/models/{model}",
  operationId: "openAiCompatibility.retrieveModelAlias",
  summary: "Retrieve an OpenAI-compatible model through the legacy API alias",
  servers: [{ url: "/" }],
  request: { params: openAiModelParams },
  responses: { 200: modelResponse, ...standardErrorResponses },
});
export const createOpenAiChatCompletionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chat/completions",
  operationId: "openAiCompatibility.createChatCompletion",
  summary: "Create an OpenAI-compatible chat completion",
  request: { body: body(OpenAiChatCompletionRequestSchema) },
  responses: { 200: completionResponse, ...providerErrors },
});
export const createOpenAiChatCompletionAliasRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/chat/completions",
  operationId: "openAiCompatibility.createChatCompletionAlias",
  summary: "Create a chat completion through the legacy API alias",
  servers: [{ url: "/" }],
  request: { body: body(OpenAiChatCompletionRequestSchema) },
  responses: { 200: completionResponse, ...providerErrors },
});
export const createOpenAiEmbeddingsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/embeddings",
  operationId: "openAiCompatibility.createEmbeddings",
  summary: "Create OpenAI-compatible embeddings",
  request: { body: body(OpenAiEmbeddingRequestSchema) },
  responses: { 200: embeddingResponse, ...providerErrors },
});
export const createOpenAiEmbeddingsAliasRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/embeddings",
  operationId: "openAiCompatibility.createEmbeddingsAlias",
  summary: "Create embeddings through the legacy API alias",
  servers: [{ url: "/" }],
  request: { body: body(OpenAiEmbeddingRequestSchema) },
  responses: { 200: embeddingResponse, ...providerErrors },
});

export const openAiCompatibilityRoutes = [
  listOpenAiModelsRoute,
  retrieveOpenAiModelRoute,
  listOpenAiModelsAliasRoute,
  retrieveOpenAiModelAliasRoute,
  createOpenAiChatCompletionRoute,
  createOpenAiChatCompletionAliasRoute,
  createOpenAiEmbeddingsRoute,
  createOpenAiEmbeddingsAliasRoute,
] as const;
