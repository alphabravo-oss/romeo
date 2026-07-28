import {
  addOpenWebUiChannelMembersRoute,
  addOpenWebUiChannelMessageReactionRoute,
  createOpenWebUiChannelRoute,
  deleteOpenWebUiChannelMessageRoute,
  deleteOpenWebUiChannelRoute,
  getOpenWebUiChannelMessageDataRoute,
  getOpenWebUiChannelMessageRoute,
  getOpenWebUiChannelRoute,
  getOrCreateOpenWebUiDmChannelRoute,
  listOpenWebUiChannelMembersRoute,
  listOpenWebUiChannelMessagesRoute,
  listOpenWebUiChannelsAliasRoute,
  listOpenWebUiChannelsRoute,
  listOpenWebUiChannelThreadMessagesRoute,
  listPinnedOpenWebUiChannelMessagesRoute,
  markOpenWebUiChannelReadRoute,
  pinOpenWebUiChannelMessageRoute,
  postOpenWebUiChannelMessageRoute,
  removeOpenWebUiChannelMembersRoute,
  removeOpenWebUiChannelMessageReactionRoute,
  streamOpenWebUiChannelEventsRoute,
  updateOpenWebUiChannelMemberActiveRoute,
  updateOpenWebUiChannelMessageRoute,
  updateOpenWebUiChannelRoute,
  type OpenWebUiChannelEvent,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerOpenWebUiChannelRoutes(app: RomeoApi): void {
  app.openapi(listOpenWebUiChannelsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.channels(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChannelsAliasRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelList(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(createOpenWebUiChannelRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.createChannel(
        context.get("subject"),
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(getOrCreateOpenWebUiDmChannelRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.dmChannelForUser(
        context.get("subject"),
        context.req.valid("param").userId,
      );
    return context.json(data, 200);
  });
  app.openapi(streamOpenWebUiChannelEventsRoute, async (context) => {
    const subject = context.get("subject");
    const bufferedEvents: OpenWebUiChannelEvent[] = [];
    let writeEvent: ((event: OpenWebUiChannelEvent) => void) | undefined;
    const subscription = await context
      .get("services")
      .openWebUiCompatibility.subscribeChannelEvents(
        subject,
        context.req.valid("param").channelId,
        (event) => {
          if (writeEvent === undefined) bufferedEvents.push(event);
          else writeEvent(event);
        },
      );
    return new Response(
      createOpenWebUiChannelEventStream({
        attachWriter: (writer) => {
          writeEvent = writer;
        },
        bufferedEvents,
        connectedEvent: subscription.connectedEvent,
        unsubscribe: subscription.unsubscribe,
      }),
      {
        headers: {
          "cache-control": "no-store",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        },
      },
    );
  });
  app.openapi(listOpenWebUiChannelMessagesRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMessages(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("query"),
      );
    return context.json(data, 200);
  });
  app.openapi(postOpenWebUiChannelMessageRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.postChannelMessage(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(markOpenWebUiChannelReadRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.markChannelRead(
        context.get("subject"),
        context.req.valid("param").channelId,
      );
    return context.json(data, 200);
  });
  app.openapi(listPinnedOpenWebUiChannelMessagesRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.pinnedChannelMessages(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("query"),
      );
    return context.json(data, 200);
  });
  app.openapi(getOpenWebUiChannelMessageRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMessage(
        context.get("subject"),
        channelId,
        messageId,
      );
    return context.json(data, 200);
  });
  app.openapi(getOpenWebUiChannelMessageDataRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMessageData(
        context.get("subject"),
        channelId,
        messageId,
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChannelThreadMessagesRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelThreadMessages(
        context.get("subject"),
        channelId,
        messageId,
        context.req.valid("query"),
      );
    return context.json(data, 200);
  });
  app.openapi(pinOpenWebUiChannelMessageRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.pinChannelMessage(
        context.get("subject"),
        channelId,
        messageId,
        context.req.valid("json").is_pinned,
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiChannelMessageRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChannelMessage(
        context.get("subject"),
        channelId,
        messageId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(addOpenWebUiChannelMessageReactionRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.addChannelMessageReaction(
        context.get("subject"),
        channelId,
        messageId,
        context.req.valid("json").name,
      );
    return context.json(data, 200);
  });
  app.openapi(removeOpenWebUiChannelMessageReactionRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.removeChannelMessageReaction(
        context.get("subject"),
        channelId,
        messageId,
        context.req.valid("json").name,
      );
    return context.json(data, 200);
  });
  app.openapi(deleteOpenWebUiChannelMessageRoute, async (context) => {
    const { channelId, messageId } = context.req.valid("param");
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteChannelMessage(
        context.get("subject"),
        channelId,
        messageId,
      );
    return context.json(data, 200);
  });
  app.openapi(getOpenWebUiChannelRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.channel(
        context.get("subject"),
        context.req.valid("param").channelId,
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChannelMembersRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMembers(
        context.get("subject"),
        context.req.valid("param").channelId,
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiChannelMemberActiveRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChannelMemberActiveStatus(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("json").is_active,
      );
    return context.json(data, 200);
  });
  app.openapi(addOpenWebUiChannelMembersRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.addChannelMembers(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(removeOpenWebUiChannelMembersRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.removeChannelMembers(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiChannelRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChannel(
        context.get("subject"),
        context.req.valid("param").channelId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(deleteOpenWebUiChannelRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteChannel(
        context.get("subject"),
        context.req.valid("param").channelId,
      );
    return context.json(data, 200);
  });
}

function createOpenWebUiChannelEventStream(input: {
  connectedEvent: OpenWebUiChannelEvent;
  bufferedEvents: OpenWebUiChannelEvent[];
  attachWriter: (writer: (event: OpenWebUiChannelEvent) => void) => void;
  unsubscribe: () => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  return new ReadableStream({
    start(controller) {
      const write = (event: OpenWebUiChannelEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeOpenWebUiChannelEvent(event)));
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

function encodeOpenWebUiChannelEvent(event: OpenWebUiChannelEvent): string {
  return `event: events:channel\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
