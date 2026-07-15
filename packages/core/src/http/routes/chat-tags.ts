import type { RomeoApi } from "../context";
import { assignChatTagSchema } from "../schemas";

export function registerChatTagRoutes(app: RomeoApi): void {
  app.get("/api/v1/chat-tags", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").chatTags.list(subject);
    return context.json({ data });
  });

  app.get("/api/v1/chat-tags/:tagSlug/chats", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chatTags.chatsForTag(subject, context.req.param("tagSlug"), {
        archived: parseChatArchiveFilter(context.req.query("archived")),
      });
    return context.json({ data });
  });

  app.get("/api/v1/chats/:chatId/tag-assignments", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").chatTags.forChat({
      subject,
      chatId: context.req.param("chatId"),
    });
    return context.json({ data });
  });

  app.post("/api/v1/chats/:chatId/tag-assignments", async (context) => {
    const subject = context.get("subject");
    const body = assignChatTagSchema.parse(await context.req.json());
    const data = await context.get("services").chatTags.assign({
      subject,
      chatId: context.req.param("chatId"),
      name: body.name,
    });
    return context.json({ data }, 201);
  });

  app.delete(
    "/api/v1/chats/:chatId/tag-assignments/:tagSlug",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").chatTags.remove({
        subject,
        chatId: context.req.param("chatId"),
        tagSlug: context.req.param("tagSlug"),
      });
      return context.json({ data });
    },
  );
}

function parseChatArchiveFilter(
  value: string | undefined,
): "active" | "all" | "archived" {
  if (value === "all" || value === "archived") return value;
  return "active";
}
