import { createSseStream } from "@romeo/ai-runtime";
import {
  cancelQueuedChatTurnRoute,
  cancelRunRoute,
  enqueueChatTurnRoute,
  getActiveRunRoute,
  getRunRoute,
  inspectPersistedRunContextRoute,
  inspectRunContextRoute,
  listQueuedChatTurnsRoute,
  startRunRoute,
  streamRunEventsRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { ApiError } from "../../errors";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { assertCapabilityFlagEnabled } from "../../services/capability-flag-enforcement";
import { applyIdempotencyHeaders } from "../idempotency-response";

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
      ...(body.routingMode === undefined
        ? {}
        : { routingMode: body.routingMode }),
      ...(body.researchMode === undefined
        ? {}
        : { researchMode: body.researchMode }),
      ...(body.reasoningPolicy === undefined
        ? {}
        : { reasoningPolicy: body.reasoningPolicy }),
      ...(body.parentMessageId === undefined
        ? {}
        : { parentMessageId: body.parentMessageId }),
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
      ...(body.routingMode === undefined
        ? {}
        : { routingMode: body.routingMode }),
      ...(body.researchMode === undefined
        ? {}
        : { researchMode: body.researchMode }),
      ...(body.reasoningPolicy === undefined
        ? {}
        : { reasoningPolicy: body.reasoningPolicy }),
      ...(body.fileIds === undefined ? {} : { fileIds: body.fileIds }),
      ...(body.webSearch === undefined ? {} : { webSearch: body.webSearch }),
      ...(body.urls === undefined ? {} : { urls: body.urls }),
      ...(body.agenticRag === undefined ? {} : { agenticRag: body.agenticRag }),
      imageCount: body.imageCount ?? 0,
    });
    return context.json({ data }, 200);
  });
  app.openapi(inspectPersistedRunContextRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const { runId } = context.req.valid("query");
    const data = await context.get("services").runs.inspectPersistedContext({
      chatId,
      subject: context.get("subject"),
      ...(runId === undefined ? {} : { runId }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(startRunRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const request = {
      subject,
      chatId: body.chatId,
      agentId: body.agentId,
      content: body.content,
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      ...(body.routingMode === undefined
        ? {}
        : { routingMode: body.routingMode }),
      ...(body.researchMode === undefined
        ? {}
        : { researchMode: body.researchMode }),
      ...(body.reasoningPolicy === undefined
        ? {}
        : { reasoningPolicy: body.reasoningPolicy }),
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
    };
    const key = resolveIdempotencyKey(
      context.req.valid("header")["idempotency-key"],
      body.idempotencyKey,
    );
    const result = await context.get("services").idempotency.execute({
      subject,
      operation: "runs.start",
      ...(key === undefined ? {} : { key }),
      request: { ...request, subject: undefined },
      responseStatus: 202,
      work: () => context.get("services").runs.startForApi(request),
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: result.value }, 202);
  });

  app.openapi(getRunRoute, async (context) => {
    const subject = context.get("subject");
    const { runId } = context.req.valid("param");
    const data = await context.get("services").runs.get(runId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(streamRunEventsRoute, async (context) => {
    const subject = context.get("subject");
    await assertCapabilityFlagEnabled(
      context.get("services").capabilityFlags,
      subject,
      "stream_transport_v2",
    );
    const { runId } = context.req.valid("param");
    const { after } = context.req.valid("query");
    const afterSequence = resolveRunEventCursor(
      after,
      context.req.header("last-event-id"),
    );
    const events = context
      .get("services")
      .runs.events(runId, subject, afterSequence, context.req.raw.signal);
    return new Response(
      createSseStream(events, {
        heartbeatMs: 10_000,
        observer: context
          .get("services")
          .runs.runSseStreamObserver(afterSequence),
        retryMs: 1_000,
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      },
    );
  });

  app.openapi(cancelRunRoute, async (context) => {
    const subject = context.get("subject");
    const { runId } = context.req.valid("param");
    const data = await context.get("services").runs.cancel(runId, subject);
    return context.json({ data }, 200);
  });
}

function resolveRunEventCursor(
  queryAfter: number | undefined,
  lastEventId: string | undefined,
): number {
  const trimmed = lastEventId?.trim();
  const headerAfter =
    trimmed === undefined || trimmed.length === 0 ? undefined : Number(trimmed);
  if (
    headerAfter !== undefined &&
    (!Number.isSafeInteger(headerAfter) || headerAfter < 0)
  ) {
    throw new ApiError(
      "invalid_run_event_cursor",
      "The run event cursor is invalid.",
      400,
    );
  }
  if (
    queryAfter !== undefined &&
    headerAfter !== undefined &&
    queryAfter !== headerAfter
  ) {
    throw new ApiError(
      "conflicting_run_event_cursor",
      "The run event cursors conflict.",
      400,
    );
  }
  return queryAfter ?? headerAfter ?? 0;
}
