import {
  assignChatTagRoute,
  listChatsForTagRoute,
  listChatTagAssignmentsRoute,
  listChatTagsRoute,
  removeChatTagRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerChatTagRoutes(app: RomeoApi): void {
  app.openapi(listChatTagsRoute, async (context) => {
    const data = await context
      .get("services")
      .chatTags.list(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(listChatsForTagRoute, async (context) => {
    const { tagSlug } = context.req.valid("param");
    const { archived } = context.req.valid("query");
    const data = await context
      .get("services")
      .chatTags.chatsForTag(
        context.get("subject"),
        tagSlug,
        archived === undefined ? {} : { archived },
      );
    return context.json({ data }, 200);
  });

  app.openapi(listChatTagAssignmentsRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const data = await context.get("services").chatTags.forChat({
      subject: context.get("subject"),
      chatId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(assignChatTagRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const { name } = context.req.valid("json");
    const data = await context.get("services").chatTags.assign({
      subject: context.get("subject"),
      chatId,
      name,
    });
    return context.json({ data }, 201);
  });

  app.openapi(removeChatTagRoute, async (context) => {
    const { chatId, tagSlug } = context.req.valid("param");
    const data = await context.get("services").chatTags.remove({
      subject: context.get("subject"),
      chatId,
      tagSlug,
    });
    return context.json({ data }, 200);
  });
}
