import type { Context } from "hono";
import {
  createOpenAiChatCompletionAliasRoute,
  createOpenAiChatCompletionRoute,
  createOpenAiEmbeddingsAliasRoute,
  createOpenAiEmbeddingsRoute,
  listOpenAiModelsAliasRoute,
  listOpenAiModelsRoute,
  retrieveOpenAiModelAliasRoute,
  retrieveOpenAiModelRoute,
  type OpenAiChatCompletionRequest,
  type OpenAiEmbeddingRequest,
} from "@romeo/contracts";

import type { AppBindings, RomeoApi } from "../context";

export function registerCompatibilityRoutes(app: RomeoApi): void {
  app.openapi(listOpenAiModelsRoute, handleModels);
  app.openapi(listOpenAiModelsAliasRoute, handleModels);
  app.openapi(retrieveOpenAiModelRoute, (context) =>
    handleModel(context, context.req.valid("param").model),
  );
  app.openapi(retrieveOpenAiModelAliasRoute, (context) =>
    handleModel(context, context.req.valid("param").model),
  );
  app.openapi(createOpenAiChatCompletionRoute, (context) =>
    handleChatCompletions(context, context.req.valid("json")),
  );
  app.openapi(createOpenAiChatCompletionAliasRoute, (context) =>
    handleChatCompletions(context, context.req.valid("json")),
  );
  app.openapi(createOpenAiEmbeddingsRoute, (context) =>
    handleEmbeddings(context, context.req.valid("json")),
  );
  app.openapi(createOpenAiEmbeddingsAliasRoute, (context) =>
    handleEmbeddings(context, context.req.valid("json")),
  );
}

async function handleModels(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const service = context.get("services").openAiModels;
  return context.json(await service.list(subject), 200);
}

async function handleModel(context: Context<AppBindings>, model: string) {
  const subject = context.get("subject");
  const service = context.get("services").openAiModels;
  return context.json(await service.retrieve(subject, model), 200);
}

async function handleChatCompletions(
  context: Context<AppBindings>,
  request: OpenAiChatCompletionRequest,
) {
  const subject = context.get("subject");
  const service = context.get("services").openAiChatCompletions;
  if (request.stream === true) {
    return new Response(await service.stream({ subject, request }), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }
  return context.json(await service.complete({ subject, request }), 200);
}

async function handleEmbeddings(
  context: Context<AppBindings>,
  request: OpenAiEmbeddingRequest,
) {
  const subject = context.get("subject");
  const service = context.get("services").openAiEmbeddings;
  return context.json(await service.create({ subject, request }), 200);
}
