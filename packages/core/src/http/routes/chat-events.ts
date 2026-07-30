import { streamChatEventsRoute, type ChatEvent } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerChatEventRoutes(app: RomeoApi): void {
  app.openapi(streamChatEventsRoute, async (context) => {
    const subject = context.get("subject");
    const { workspaceId } = context.req.valid("param");
    const bufferedEvents: ChatEvent[] = [];
    let writeEvent: ((event: ChatEvent) => void) | undefined;
    const lastEventId = context.req.header("last-event-id")?.trim();
    const subscription = await context.get("services").chatEvents.subscribe(
      subject,
      workspaceId,
      (event) => {
        if (writeEvent === undefined) bufferedEvents.push(event);
        else writeEvent(event);
      },
      lastEventId === undefined || lastEventId.length === 0
        ? {}
        : { afterEventId: lastEventId.slice(0, 300) },
    );

    return new Response(
      createChatEventStream({
        attachWriter: (writer) => {
          writeEvent = writer;
        },
        bufferedEvents,
        connectedEvent: subscription.connectedEvent,
        unsubscribe: subscription.unsubscribe,
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      },
    );
  });
}

function createChatEventStream(input: {
  connectedEvent: ChatEvent;
  bufferedEvents: ChatEvent[];
  attachWriter: (writer: (event: ChatEvent) => void) => void;
  unsubscribe: () => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream({
    start(controller) {
      const write = (event: ChatEvent) => {
        if (closed) return;
        const eventName =
          event.type === "connected" ? "chats:connected" : "chats:changed";
        const id = event.type === "changed" ? `id: ${event.id}\n` : "";
        controller.enqueue(
          encoder.encode(
            `event: ${eventName}\n${id}data: ${JSON.stringify(event)}\n\n`,
          ),
        );
      };
      input.attachWriter(write);
      write(input.connectedEvent);
      for (const event of input.bufferedEvents.splice(0)) write(event);
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
    },
    cancel() {
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      input.unsubscribe();
    },
  });
}
