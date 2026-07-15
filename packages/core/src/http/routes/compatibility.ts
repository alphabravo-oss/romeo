import type { Context } from "hono";

import type { AppBindings, RomeoApi } from "../context";
import {
  openAiChatCompletionRequestSchema,
  openAiEmbeddingRequestSchema,
} from "../schemas/compatibility";

export function registerCompatibilityRoutes(app: RomeoApi): void {
  app.get("/api/v1/openai/models", handleModels);
  app.get("/api/v1/openai/models/:model", handleModel);
  app.get("/api/models", handleModels);
  app.get("/api/models/:model", handleModel);
  app.post("/api/v1/chat/completions", handleChatCompletions);
  app.post("/api/chat/completions", handleChatCompletions);
  app.post("/api/v1/embeddings", handleEmbeddings);
  app.post("/api/embeddings", handleEmbeddings);
}

async function handleModels(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const service = context.get("services").openAiModels;
  return context.json(await service.list(subject));
}

async function handleModel(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const service = context.get("services").openAiModels;
  return context.json(
    await service.retrieve(subject, context.req.param("model") ?? ""),
  );
}

async function handleChatCompletions(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const request = openAiChatCompletionRequestSchema.parse(
    await context.req.json(),
  );
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
  return context.json(await service.complete({ subject, request }));
}

async function handleEmbeddings(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const request = openAiEmbeddingRequestSchema.parse(await context.req.json());
  const service = context.get("services").openAiEmbeddings;
  return context.json(await service.create({ subject, request }));
}
