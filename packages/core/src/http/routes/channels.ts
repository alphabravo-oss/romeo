import {
  addChannelMembersRoute,
  addChannelReactionRoute,
  createChannelMessageRoute,
  createChannelRoute,
  createDirectMessageChannelRoute,
  deleteChannelMessageRoute,
  deleteChannelRoute,
  getChannelMessageRoute,
  getChannelRoute,
  listChannelMembersRoute,
  listChannelMessagesRoute,
  listChannelThreadRoute,
  listChannelsRoute,
  listPinnedChannelMessagesRoute,
  markChannelReadRoute,
  pinChannelMessageRoute,
  removeChannelMemberRoute,
  removeChannelReactionRoute,
  streamChannelEventsRoute,
  updateChannelMessageRoute,
  updateChannelRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import type { ChannelEvent } from "../../services/channel-service";

export function registerChannelRoutes(app: RomeoApi): void {
  app.openapi(listChannelsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").channels.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createChannelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").channels.create(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(createDirectMessageChannelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .channels.directMessage(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(getChannelRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.get(subject, context.req.valid("param").channelId);
    return context.json({ data }, 200);
  });

  app.openapi(updateChannelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .channels.update(subject, context.req.valid("param").channelId, body);
    return context.json({ data }, 200);
  });

  app.openapi(deleteChannelRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.delete(subject, context.req.valid("param").channelId);
    return context.json({ data }, 200);
  });

  app.openapi(streamChannelEventsRoute, async (context) => {
    const subject = context.get("subject");
    const bufferedEvents: ChannelEvent[] = [];
    let writeEvent: ((event: ChannelEvent) => void) | undefined;
    const subscription = await context
      .get("services")
      .channels.subscribeEvents(
        subject,
        context.req.valid("param").channelId,
        (event) => {
          if (writeEvent === undefined) bufferedEvents.push(event);
          else writeEvent(event);
        },
      );

    return new Response(
      createChannelEventStream({
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

  app.openapi(listChannelMembersRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.members(subject, context.req.valid("param").channelId);
    return context.json({ data }, 200);
  });

  app.openapi(addChannelMembersRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .channels.addMembers(subject, context.req.valid("param").channelId, body);
    return context.json({ data }, 201);
  });

  app.openapi(removeChannelMemberRoute, async (context) => {
    const subject = context.get("subject");
    const { channelId, userId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.removeMember(subject, channelId, userId);
    return context.json({ data }, 200);
  });

  app.openapi(listChannelMessagesRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .channels.messages(subject, context.req.valid("param").channelId, {
        limit: query.limit,
        offset: query.offset,
      });
    return context.json({ data }, 200);
  });

  app.openapi(createChannelMessageRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .channels.postMessage(
        subject,
        context.req.valid("param").channelId,
        body,
      );
    return context.json({ data }, 201);
  });

  app.openapi(markChannelReadRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.markRead(subject, context.req.valid("param").channelId);
    return context.json({ data }, 200);
  });

  app.openapi(listPinnedChannelMessagesRoute, async (context) => {
    const subject = context.get("subject");
    const { page } = context.req.valid("query");
    const data = await context
      .get("services")
      .channels.pinnedMessages(subject, context.req.valid("param").channelId, {
        page,
      });
    return context.json({ data }, 200);
  });

  app.openapi(getChannelMessageRoute, async (context) => {
    const subject = context.get("subject");
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.message(subject, channelId, messageId);
    return context.json({ data }, 200);
  });

  app.openapi(updateChannelMessageRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.updateMessage(subject, channelId, messageId, body);
    return context.json({ data }, 200);
  });

  app.openapi(deleteChannelMessageRoute, async (context) => {
    const subject = context.get("subject");
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.deleteMessage(subject, channelId, messageId);
    return context.json({ data }, 200);
  });

  app.openapi(listChannelThreadRoute, async (context) => {
    const subject = context.get("subject");
    const { channelId, messageId } = context.req.valid("param");
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .channels.threadMessages(subject, channelId, messageId, {
        limit: query.limit,
        offset: query.offset,
      });
    return context.json({ data }, 200);
  });

  app.openapi(pinChannelMessageRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.pinMessage(subject, channelId, messageId, body);
    return context.json({ data }, 200);
  });

  app.openapi(addChannelReactionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.addReaction(subject, channelId, messageId, body.name);
    return context.json({ data }, 201);
  });

  app.openapi(removeChannelReactionRoute, async (context) => {
    const subject = context.get("subject");
    const { channelId, messageId, name } = context.req.valid("param");
    const data = await context
      .get("services")
      .channels.removeReaction(subject, channelId, messageId, name);
    return context.json({ data }, 200);
  });
}

function createChannelEventStream(input: {
  connectedEvent: ChannelEvent;
  bufferedEvents: ChannelEvent[];
  attachWriter: (writer: (event: ChannelEvent) => void) => void;
  unsubscribe: () => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;

  return new ReadableStream({
    start(controller) {
      const write = (event: ChannelEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeChannelEvent(event)));
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

function encodeChannelEvent(event: ChannelEvent): string {
  return `event: events:channel\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
