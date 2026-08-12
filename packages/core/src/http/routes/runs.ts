import { createSseStream } from "@romeo/ai-runtime";
import {
  cancelQueuedChatTurnRoute,
  cancelRunRoute,
  enqueueChatTurnRoute,
  getActiveRunRoute,
  getRunRoute,
  inspectRunContextRoute,
  listQueuedChatTurnsRoute,
  startRunRoute,
  streamRunEventsRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerRunRoutes(app: RomeoApi): void {
  app.openapi(getActiveRunRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const data = await context
      .get("services")
      .runs.activeForChat(chatId, context.get("subject"));
    return context.json({ data: data ?? null }, 200);
  });
  app.openapi(listQueuedChatTurnsRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const data = await context
      .get("services")
      .runs.queuedForChat(chatId, context.get("subject"));
    return context.json({ data }, 200);
  });
  app.openapi(enqueueChatTurnRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").runs.enqueueTurn({
      subject: context.get("subject"),
      chatId,
      agentId: body.agentId,
      content: body.content,
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      ...(body.webSearch === undefined ? {} : { webSearch: body.webSearch }),
      ...(body.urls === undefined ? {} : { urls: body.urls }),
      ...(body.agenticRag === undefined ? {} : { agenticRag: body.agenticRag }),
      ...(body.knowledgeBaseIds === undefined
        ? {}
        : { knowledgeBaseIds: body.knowledgeBaseIds }),
      ...(body.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: body.idempotencyKey }),
    });
    return context.json({ data }, 202);
  });
  app.openapi(cancelQueuedChatTurnRoute, async (context) => {
    const { chatId, turnId } = context.req.valid("param");
    const data = await context
      .get("services")
      .runs.cancelQueuedTurn(chatId, turnId, context.get("subject"));
    return context.json({ data }, 200);
  });
  app.openapi(inspectRunContextRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").runs.inspectContext({
      subject: context.get("subject"),
      chatId: body.chatId,
      agentId: body.agentId,
      content: body.content,
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      ...(body.fileIds === undefined ? {} : { fileIds: body.fileIds }),
      ...(body.webSearch === undefined ? {} : { webSearch: body.webSearch }),
      ...(body.urls === undefined ? {} : { urls: body.urls }),
      ...(body.agenticRag === undefined ? {} : { agenticRag: body.agenticRag }),
      imageCount: body.imageCount ?? 0,
    });
    return context.json({ data }, 200);
  });

  app.openapi(startRunRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").runs.start({
      subject,
      chatId: body.chatId,
      agentId: body.agentId,
      content: body.content,
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      ...(body.historyBoundaryMessageId === undefined
        ? {}
        : { historyBoundaryMessageId: body.historyBoundaryMessageId }),
      ...(body.parentMessageId === undefined
        ? {}
        : { parentMessageId: body.parentMessageId }),
      ...(body.knowledgeBaseIds === undefined
        ? {}
        : { knowledgeBaseIds: body.knowledgeBaseIds }),
      ...(body.fileIds === undefined ? {} : { fileIds: body.fileIds }),
      ...(body.webSearch === undefined ? {} : { webSearch: body.webSearch }),
      ...(body.urls === undefined ? {} : { urls: body.urls }),
      ...(body.agenticRag === undefined ? {} : { agenticRag: body.agenticRag }),
      ...(body.attachments === undefined
        ? {}
        : { attachments: body.attachments }),
    });
    return context.json({ data }, 202);
  });

  app.openapi(getRunRoute, async (context) => {
    const subject = context.get("subject");
    const { runId } = context.req.valid("param");
    const data = await context.get("services").runs.get(runId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(streamRunEventsRoute, (context) => {
    const subject = context.get("subject");
    const { runId } = context.req.valid("param");
    const { after: afterSequence = 0 } = context.req.valid("query");
    const events = context
      .get("services")
      .runs.events(runId, subject, afterSequence);
    return new Response(createSseStream(events), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  });

  app.openapi(cancelRunRoute, async (context) => {
    const subject = context.get("subject");
    const { runId } = context.req.valid("param");
    const data = await context.get("services").runs.cancel(runId, subject);
    return context.json({ data }, 200);
  });
}
