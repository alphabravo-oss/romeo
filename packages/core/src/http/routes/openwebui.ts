import type { Context } from "hono";

import type { OpenWebUiChannelEvent } from "../../services/openwebui-compatibility-service";
import type { AppBindings, RomeoApi } from "../context";
import {
  openWebUiChatTagLookupSchema,
  openWebUiChannelMessagePinSchema,
  openWebUiChannelMessageReactionSchema,
  openWebUiChannelMessageSchema,
  openWebUiChannelMessagesQuerySchema,
  openWebUiChannelPinnedMessagesQuerySchema,
  openWebUiChannelSchema,
  openWebUiCreateChatSchema,
  openWebUiCreateFolderSchema,
  openWebUiUpdateChannelMemberActiveSchema,
  openWebUiUpdateChannelMembersSchema,
  openWebUiUpdateChannelSchema,
  openWebUiUpdateChatFolderSchema,
  openWebUiUpdateFolderExpandedSchema,
  openWebUiUpdateFolderParentSchema,
  openWebUiUpdateFolderSchema,
} from "../openwebui-schemas";

export function registerOpenWebUiRoutes(app: RomeoApi): void {
  app.get("/api/v1/auths/", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.sessionUser(subject);
    return context.json(data);
  });
  app.get("/api/v1/chats/", handleChatList);
  app.get("/api/v1/chats/list", handleChatList);
  app.post("/api/v1/chats/new", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiCreateChatSchema.parse(await context.req.json());
    const input =
      body.folder_id === undefined
        ? { chat: body.chat }
        : { chat: body.chat, folder_id: body.folder_id };
    const data = await context
      .get("services")
      .openWebUiCompatibility.createChat(subject, input);
    return context.json(data);
  });
  app.get("/api/v1/chats/pinned", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.pinnedChats(subject);
    return context.json(data);
  });
  app.get("/api/v1/chats/:chatId/pinned", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatPinnedStatus(
        subject,
        context.req.param("chatId"),
      );
    return context.json(data);
  });
  app.post("/api/v1/chats/:chatId/pin", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.toggleChatPinned(
        subject,
        context.req.param("chatId"),
      );
    return context.json(data);
  });
  app.get("/api/v1/chats/search", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.searchChats(
        subject,
        context.req.query("text") ?? "",
        {
          page: queryPage(context),
        },
      );
    return context.json(data);
  });
  app.get("/api/v1/chats/archived", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.archivedChats(subject, {
        page: queryPage(context),
      });
    return context.json(data);
  });
  app.get("/api/v1/chats/all/archived", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.allArchivedChats(subject);
    return context.json(data);
  });
  app.get("/api/v1/chats/all/tags", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.allTags(subject);
    return context.json(data);
  });
  app.post("/api/v1/chats/tags", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiChatTagLookupSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByTag(subject, body.name);
    return context.json(data);
  });
  app.get("/api/v1/chats/:chatId/tags", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatTags(subject, context.req.param("chatId"));
    return context.json(data);
  });
  app.post("/api/v1/chats/:chatId/tags", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiChatTagLookupSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.addChatTag(
        subject,
        context.req.param("chatId"),
        body.name,
      );
    return context.json(data);
  });
  app.delete("/api/v1/chats/:chatId/tags", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiChatTagLookupSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteChatTag(
        subject,
        context.req.param("chatId"),
        body.name,
      );
    return context.json(data);
  });
  app.get("/api/v1/chats/folder/:folderId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByFolder(
        subject,
        context.req.param("folderId"),
      );
    return context.json(data);
  });
  app.get("/api/v1/chats/folder/:folderId/list", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByFolder(
        subject,
        context.req.param("folderId"),
        { compact: true, page: queryPage(context) },
      );
    return context.json(data);
  });
  app.post("/api/v1/chats/:chatId/folder", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateChatFolderSchema.parse(
      await context.req.json(),
    );
    const input =
      body.folder_id === undefined
        ? { folder_id: null }
        : { folder_id: body.folder_id };
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChatFolder(
        subject,
        context.req.param("chatId"),
        input,
      );
    return context.json(data);
  });
  app.get("/api/v1/folders/", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.folders(subject);
    return context.json(data);
  });
  app.post("/api/v1/folders/", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiCreateFolderSchema.parse(await context.req.json());
    const input = {
      name: body.name,
      ...(body.data !== undefined ? { data: body.data } : {}),
      ...(body.meta !== undefined ? { meta: body.meta } : {}),
      ...(body.parent_id !== undefined ? { parent_id: body.parent_id } : {}),
    };
    const data = await context
      .get("services")
      .openWebUiCompatibility.createFolder(subject, input);
    return context.json(data);
  });
  app.get("/api/v1/folders/:folderId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.folder(subject, context.req.param("folderId"));
    return context.json(data);
  });
  app.post("/api/v1/folders/:folderId/update", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateFolderSchema.parse(await context.req.json());
    const input = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
      ...(body.meta !== undefined ? { meta: body.meta } : {}),
      ...(body.parent_id !== undefined ? { parent_id: body.parent_id } : {}),
    };
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolder(
        subject,
        context.req.param("folderId"),
        input,
      );
    return context.json(data);
  });
  app.post("/api/v1/folders/:folderId/update/expanded", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateFolderExpandedSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolderExpanded(
        subject,
        context.req.param("folderId"),
        body.is_expanded,
      );
    return context.json(data);
  });
  app.post("/api/v1/folders/:folderId/update/parent", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateFolderParentSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolderParent(
        subject,
        context.req.param("folderId"),
        body.parent_id ?? null,
      );
    return context.json(data);
  });
  app.delete("/api/v1/folders/:folderId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteFolder(
        subject,
        context.req.param("folderId"),
        context.req.query("delete_contents") === "true",
      );
    return context.json(data);
  });
  app.get("/api/v1/channels/", handleChannels);
  app.get("/api/v1/channels/list", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelList(subject);
    return context.json(data);
  });
  app.post("/api/v1/channels/create", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiChannelSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.createChannel(subject, body);
    return context.json(data);
  });
  app.get("/api/v1/channels/users/:userId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.dmChannelForUser(
        subject,
        context.req.param("userId"),
      );
    return context.json(data);
  });
  app.get("/api/v1/channels/:channelId/events", async (context) => {
    const subject = context.get("subject");
    const bufferedEvents: OpenWebUiChannelEvent[] = [];
    let writeEvent: ((event: OpenWebUiChannelEvent) => void) | undefined;
    const subscription = await context
      .get("services")
      .openWebUiCompatibility.subscribeChannelEvents(
        subject,
        context.req.param("channelId"),
        (event) => {
          if (writeEvent === undefined) bufferedEvents.push(event);
          else writeEvent(event);
        },
      );

    return new Response(
      createCollaborationChannelEventStream({
        connectedEvent: subscription.connectedEvent,
        bufferedEvents,
        attachWriter: (writer) => {
          writeEvent = writer;
        },
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
  app.get("/api/v1/channels/:channelId/messages", async (context) => {
    const subject = context.get("subject");
    const query = openWebUiChannelMessagesQuerySchema.parse({
      skip: context.req.query("skip"),
      limit: context.req.query("limit"),
    });
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMessages(
        subject,
        context.req.param("channelId"),
        query,
      );
    return context.json(data);
  });
  app.post("/api/v1/channels/:channelId/messages/post", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiChannelMessageSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.postChannelMessage(
        subject,
        context.req.param("channelId"),
        body,
      );
    return context.json(data);
  });
  app.post("/api/v1/channels/:channelId/messages/read", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.markChannelRead(
        subject,
        context.req.param("channelId"),
      );
    return context.json(data);
  });
  app.get("/api/v1/channels/:channelId/messages/pinned", async (context) => {
    const subject = context.get("subject");
    const query = openWebUiChannelPinnedMessagesQuerySchema.parse({
      page: context.req.query("page"),
    });
    const data = await context
      .get("services")
      .openWebUiCompatibility.pinnedChannelMessages(
        subject,
        context.req.param("channelId"),
        query,
      );
    return context.json(data);
  });
  app.get(
    "/api/v1/channels/:channelId/messages/:messageId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .openWebUiCompatibility.channelMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
        );
      return context.json(data);
    },
  );
  app.get(
    "/api/v1/channels/:channelId/messages/:messageId/data",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .openWebUiCompatibility.channelMessageData(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
        );
      return context.json(data);
    },
  );
  app.get(
    "/api/v1/channels/:channelId/messages/:messageId/thread",
    async (context) => {
      const subject = context.get("subject");
      const query = openWebUiChannelMessagesQuerySchema.parse({
        skip: context.req.query("skip"),
        limit: context.req.query("limit"),
      });
      const data = await context
        .get("services")
        .openWebUiCompatibility.channelThreadMessages(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          query,
        );
      return context.json(data);
    },
  );
  app.post(
    "/api/v1/channels/:channelId/messages/:messageId/pin",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiChannelMessagePinSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.pinChannelMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body.is_pinned,
        );
      return context.json(data);
    },
  );
  app.post(
    "/api/v1/channels/:channelId/messages/:messageId/update",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiChannelMessageSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.updateChannelMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body,
        );
      return context.json(data);
    },
  );
  app.post(
    "/api/v1/channels/:channelId/messages/:messageId/reactions/add",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiChannelMessageReactionSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.addChannelMessageReaction(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body.name,
        );
      return context.json(data);
    },
  );
  app.post(
    "/api/v1/channels/:channelId/messages/:messageId/reactions/remove",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiChannelMessageReactionSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.removeChannelMessageReaction(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
          body.name,
        );
      return context.json(data);
    },
  );
  app.delete(
    "/api/v1/channels/:channelId/messages/:messageId/delete",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .openWebUiCompatibility.deleteChannelMessage(
          subject,
          context.req.param("channelId"),
          context.req.param("messageId"),
        );
      return context.json(data);
    },
  );
  app.get("/api/v1/channels/:channelId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channel(subject, context.req.param("channelId"));
    return context.json(data);
  });
  app.get("/api/v1/channels/:channelId/members", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.channelMembers(
        subject,
        context.req.param("channelId"),
      );
    return context.json(data);
  });
  app.post("/api/v1/channels/:channelId/members/active", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateChannelMemberActiveSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChannelMemberActiveStatus(
        subject,
        context.req.param("channelId"),
        body.is_active,
      );
    return context.json(data);
  });
  app.post(
    "/api/v1/channels/:channelId/update/members/add",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiUpdateChannelMembersSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.addChannelMembers(
          subject,
          context.req.param("channelId"),
          body,
        );
      return context.json(data);
    },
  );
  app.post(
    "/api/v1/channels/:channelId/update/members/remove",
    async (context) => {
      const subject = context.get("subject");
      const body = openWebUiUpdateChannelMembersSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .openWebUiCompatibility.removeChannelMembers(
          subject,
          context.req.param("channelId"),
          body,
        );
      return context.json(data);
    },
  );
  app.post("/api/v1/channels/:channelId/update", async (context) => {
    const subject = context.get("subject");
    const body = openWebUiUpdateChannelSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChannel(
        subject,
        context.req.param("channelId"),
        body,
      );
    return context.json(data);
  });
  app.delete("/api/v1/channels/:channelId/delete", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteChannel(
        subject,
        context.req.param("channelId"),
      );
    return context.json(data);
  });
  app.get("/api/v1/openwebui/config", handleConfig);
  app.get("/api/v1/openwebui/version", handleVersion);
  app.get("/api/v1/openwebui/version/updates", handleVersionUpdates);
  app.get("/api/config", handleConfig);
  app.get("/api/version", handleVersion);
  app.get("/api/version/updates", handleVersionUpdates);
}

function handleChatList(context: Context<AppBindings>) {
  const subject = context.get("subject");
  const includePinned = context.req.query("include_pinned") === "true";
  return context
    .get("services")
    .openWebUiCompatibility.chatList(subject, {
      includeFolders: context.req.query("include_folders") === "true",
      includePinned,
      page: queryPage(context),
    })
    .then((data) => context.json(data));
}

function handleChannels(context: Context<AppBindings>) {
  const subject = context.get("subject");
  return context
    .get("services")
    .openWebUiCompatibility.channels(subject)
    .then((data) => context.json(data));
}

function handleConfig(context: Context<AppBindings>) {
  return context.json(context.get("services").openWebUiCompatibility.config());
}

function handleVersion(context: Context<AppBindings>) {
  return context.json(context.get("services").openWebUiCompatibility.version());
}

function handleVersionUpdates(context: Context<AppBindings>) {
  return context.json(
    context.get("services").openWebUiCompatibility.versionUpdates(),
  );
}

function queryPage(context: Context<AppBindings>): number | null {
  const page = context.req.query("page");
  if (page === undefined) return null;
  const parsed = Number(page);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function createCollaborationChannelEventStream(input: {
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
