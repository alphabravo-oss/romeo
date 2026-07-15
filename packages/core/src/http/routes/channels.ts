import type { Context } from "hono";

import type { RomeoApi } from "../context";
import type { AppBindings } from "../context";
import {
  addChannelMembersSchema,
  channelMessageReactionSchema,
  createChannelMessageSchema,
  createChannelSchema,
  createDirectMessageChannelSchema,
  pinChannelMessageSchema,
  updateChannelSchema,
} from "../schemas";
import type { ChannelEvent } from "../../services/channel-service";

export function registerChannelRoutes(app: RomeoApi): void {
  app.get("/api/v1/collaboration/channels", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").channels.list(subject);
    return context.json({ data });
  });

  app.post("/api/v1/collaboration/channels", async (context) => {
    const subject = context.get("subject");
    const body = createChannelSchema.parse(await context.req.json());
    const data = await context.get("services").channels.create(subject, body);
    return context.json({ data }, 201);
  });

  app.post(
    "/api/v1/collaboration/channels/direct-messages",
    async (context) => {
      const subject = context.get("subject");
      const body = createDirectMessageChannelSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .channels.directMessage(subject, body);
      return context.json({ data }, 201);
    },
  );

  app.get("/api/v1/collaboration/channels/:channelId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.get(subject, context.req.param("channelId"));
    return context.json({ data });
  });

  app.patch("/api/v1/collaboration/channels/:channelId", async (context) => {
    const subject = context.get("subject");
    const body = updateChannelSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .channels.update(subject, context.req.param("channelId"), body);
    return context.json({ data });
  });

  app.delete("/api/v1/collaboration/channels/:channelId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .channels.delete(subject, context.req.param("channelId"));
    return context.json({ data });
  });

  app.get(
    "/api/v1/collaboration/channels/:channelId/events",
    async (context) => {
      const subject = context.get("subject");
      const bufferedEvents: ChannelEvent[] = [];
      let writeEvent: ((event: ChannelEvent) => void) | undefined;
      const subscription = await context
        .get("services")
        .channels.subscribeEvents(
          subject,
          context.req.param("channelId"),
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
    },
  );

  app.get(
    "/api/v1/collaboration/channels/:channelId/members",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.members(subject, context.req.param("channelId"));
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/collaboration/channels/:channelId/members",
    async (context) => {
      const subject = context.get("subject");
      const body = addChannelMembersSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .channels.addMembers(subject, context.req.param("channelId"), body);
      return context.json({ data }, 201);
    },
  );

  app.delete(
    "/api/v1/collaboration/channels/:channelId/members/:userId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.removeMember(
          subject,
          context.req.param("channelId"),
          context.req.param("userId"),
        );
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/collaboration/channels/:channelId/messages",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").channels.messages(
        subject,
        context.req.param("channelId"),
        {
          limit: numericQuery(context, "limit"),
          offset: numericQuery(context, "offset"),
        },
      );
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/collaboration/channels/:channelId/messages",
    async (context) => {
      const subject = context.get("subject");
      const body = createChannelMessageSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .channels.postMessage(subject, context.req.param("channelId"), body);
      return context.json({ data }, 201);
    },
  );

  app.post(
    "/api/v1/collaboration/channels/:channelId/read",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.markRead(subject, context.req.param("channelId"));
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/collaboration/channels/:channelId/messages/pinned",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").channels.pinnedMessages(
        subject,
        context.req.param("channelId"),
        { page: numericQuery(context, "page") },
      );
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.message(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
        );
      return context.json({ data });
    },
  );

  app.patch(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId",
    async (context) => {
      const subject = context.get("subject");
      const body = createChannelMessageSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .channels.updateMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body,
        );
      return context.json({ data });
    },
  );

  app.delete(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.deleteMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
        );
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId/thread",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").channels.threadMessages(
        subject,
        context.req.param("channelId"),
        context.req.param("messageId"),
        {
          limit: numericQuery(context, "limit"),
          offset: numericQuery(context, "offset"),
        },
      );
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId/pin",
    async (context) => {
      const subject = context.get("subject");
      const body = pinChannelMessageSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .channels.pinMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body,
        );
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId/reactions",
    async (context) => {
      const subject = context.get("subject");
      const body = channelMessageReactionSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .channels.addReaction(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body.name,
        );
      return context.json({ data }, 201);
    },
  );

  app.delete(
    "/api/v1/collaboration/channels/:channelId/messages/:messageId/reactions/:name",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .channels.removeReaction(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          context.req.param("name"),
        );
      return context.json({ data });
    },
  );
}

function numericQuery(
  context: Context<AppBindings>,
  key: string,
): number | undefined {
  const value = context.req.query(key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
