import { streamChatEventsRoute, type ChatEvent } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerChatEventRoutes(app: RomeoApi): void {
  app.openapi(streamChatEventsRoute, async (context) => {
    const subject = context.get("subject");
    const { workspaceId } = context.req.valid("param");
    const bufferedEvents: ChatEvent[] = [];
    let writeEvent: ((event: ChatEvent) => void) | undefined;
    const subscription = context
      .get("services")
      .chatEvents.subscribe(subject, workspaceId, (event) => {
        if (writeEvent === undefined) bufferedEvents.push(event);
        else writeEvent(event);
      });

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

  return new ReadableStream({
    start(controller) {
      const write = (event: ChatEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `event: chats:changed\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      };
      input.attachWriter(write);
      write(input.connectedEvent);
      for (const event of input.bufferedEvents.splice(0)) write(event);
    },
    cancel() {
      closed = true;
      input.unsubscribe();
    },
  });
}
