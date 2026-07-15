import type { RomeoApi } from "../context";
import {
  createChatCommentSchema,
  createChatSchema,
  deleteChatSchema,
  forkChatSchema,
  updateChatLegalHoldSchema,
  updateChatSchema,
  updateMessageFeedbackSchema,
} from "../schemas";

export function registerChatRoutes(app: RomeoApi): void {
  app.get("/api/v1/chats", async (context) => {
    const subject = context.get("subject");
    const workspaceId =
      context.req.query("workspaceId") ?? subject.workspaceIds[0];
    const archived = parseChatArchiveFilter(context.req.query("archived"));
    const data = workspaceId
      ? await context
          .get("services")
          .chats.list(workspaceId, subject, { archived })
      : [];
    return context.json({ data });
  });

  app.post("/api/v1/chats", async (context) => {
    const subject = context.get("subject");
    const body = createChatSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .chats.create({ subject, ...body });
    return context.json({ data }, 201);
  });

  app.get("/api/v1/chats/:chatId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.get(context.req.param("chatId"), subject);
    return context.json({ data });
  });

  app.patch("/api/v1/chats/:chatId", async (context) => {
    const subject = context.get("subject");
    const body = updateChatSchema.parse(await context.req.json());
    const data = await context.get("services").chats.update({
      subject,
      chatId: context.req.param("chatId"),
      ...(body.title !== undefined ? { title: body.title } : {}),
    });
    return context.json({ data });
  });

  app.get("/api/v1/chats/:chatId/delete-preview", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.deletePreview({ subject, chatId: context.req.param("chatId") });
    return context.json({ data });
  });

  app.delete("/api/v1/chats/:chatId", async (context) => {
    const subject = context.get("subject");
    const body = deleteChatSchema.parse(await context.req.json());
    const data = await context.get("services").chats.delete({
      subject,
      chatId: context.req.param("chatId"),
      confirmChatId: body.confirmChatId,
    });
    return context.json({ data });
  });

  app.get("/api/v1/chats/:chatId/messages", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.messages(context.req.param("chatId"), subject);
    return context.json({ data });
  });

  app.delete(
    "/api/v1/chats/:chatId/messages/:messageId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").chats.deleteMessage({
        subject,
        chatId: context.req.param("chatId"),
        messageId: context.req.param("messageId"),
      });
      return context.json({ data });
    },
  );

  app.get("/api/v1/chats/:chatId/message-feedback", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.messageFeedbackList(context.req.param("chatId"), subject);
    return context.json({ data });
  });

  app.get(
    "/api/v1/chats/:chatId/messages/:messageId/feedback",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").chats.messageFeedback({
        subject,
        chatId: context.req.param("chatId"),
        messageId: context.req.param("messageId"),
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/chats/:chatId/messages/:messageId/feedback",
    async (context) => {
      const subject = context.get("subject");
      const body = updateMessageFeedbackSchema.parse(await context.req.json());
      const data = await context.get("services").chats.updateMessageFeedback({
        subject,
        chatId: context.req.param("chatId"),
        messageId: context.req.param("messageId"),
        rating: body.rating,
        ...(body.reasonCode !== undefined
          ? { reasonCode: body.reasonCode }
          : {}),
      });
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/chats/:chatId/messages/:messageId/attachments/:attachmentId",
    async (context) => {
      const subject = context.get("subject");
      const attachment = await context.get("services").chats.readAttachment({
        subject,
        chatId: context.req.param("chatId"),
        messageId: context.req.param("messageId"),
        attachmentId: context.req.param("attachmentId"),
      });
      return new Response(toArrayBuffer(attachment.bytes), {
        headers: {
          "cache-control": "private, max-age=300",
          "content-disposition": `inline; filename="${attachment.fileName.replace(/"/gu, "")}"`,
          "content-length": String(attachment.bytes.byteLength),
          "content-type": attachment.mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    },
  );

  app.post("/api/v1/chats/:chatId/archive", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.archive({ subject, chatId: context.req.param("chatId") });
    return context.json({ data });
  });

  app.post("/api/v1/chats/:chatId/fork", async (context) => {
    const subject = context.get("subject");
    const body = forkChatSchema.parse(await context.req.json());
    const data = await context.get("services").chats.fork({
      subject,
      chatId: context.req.param("chatId"),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.throughMessageId !== undefined
        ? { throughMessageId: body.throughMessageId }
        : {}),
      ...(body.includeAttachments !== undefined
        ? { includeAttachments: body.includeAttachments }
        : {}),
    });
    return context.json({ data }, 201);
  });

  app.post("/api/v1/chats/:chatId/unarchive", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.unarchive({ subject, chatId: context.req.param("chatId") });
    return context.json({ data });
  });

  app.post("/api/v1/chats/:chatId/legal-hold", async (context) => {
    const subject = context.get("subject");
    const body = updateChatLegalHoldSchema.parse(await context.req.json());
    const data = await context.get("services").chats.updateLegalHold({
      subject,
      chatId: context.req.param("chatId"),
      ...(body.legalHoldUntil !== undefined
        ? { legalHoldUntil: body.legalHoldUntil }
        : {}),
      ...(body.legalHoldReason !== undefined
        ? { legalHoldReason: body.legalHoldReason }
        : {}),
    });
    return context.json({ data });
  });

  app.get("/api/v1/chats/:chatId/comments", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chatComments.list(subject, context.req.param("chatId"));
    return context.json({ data });
  });

  app.post("/api/v1/chats/:chatId/comments", async (context) => {
    const subject = context.get("subject");
    const body = createChatCommentSchema.parse(await context.req.json());
    const data = await context.get("services").chatComments.create({
      subject,
      chatId: context.req.param("chatId"),
      body: body.body,
    });
    return context.json({ data }, 201);
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseChatArchiveFilter(
  value: string | undefined,
): "active" | "all" | "archived" {
  if (value === "all" || value === "archived") return value;
  return "active";
}
