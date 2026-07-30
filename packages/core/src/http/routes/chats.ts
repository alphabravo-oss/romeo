import type { RomeoApi } from "../context";
import type { AuthSubject } from "@romeo/auth";
import type { RomeoServices } from "../../services";
import {
  archiveChatRoute,
  cleanupExpiredChatsRoute,
  createChatCommentRoute,
  createChatRoute,
  deleteChatRoute,
  deleteMessageRoute,
  exportChatRoute,
  forkChatRoute,
  getChatRoute,
  getMessageFeedbackRoute,
  importChatRoute,
  listChatCommentsRoute,
  listChatsRoute,
  listMessageFeedbackRoute,
  listMessagesRoute,
  previewAttachmentRoute,
  previewDeleteChatRoute,
  readAttachmentRoute,
  searchChatsRoute,
  unarchiveChatRoute,
  updateAttachmentRetentionRoute,
  updateChatLegalHoldRoute,
  updateChatRoute,
  updateMessageFeedbackRoute,
} from "@romeo/contracts";
import { registerChatEventRoutes } from "./chat-events";

export function registerChatRoutes(app: RomeoApi): void {
  registerChatEventRoutes(app);
  app.openapi(cleanupExpiredChatsRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .chats.cleanupExpiredTemporaryChats({
        subject: context.get("subject"),
        ...(body.workspaceId === undefined
          ? {}
          : { workspaceId: body.workspaceId }),
      });
    return context.json({ data });
  });
  app.openapi(listChatsRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const workspaceId = query.workspaceId ?? subject.workspaceIds[0];
    const archived = query.archived ?? "active";
    const { limit, offset } = query;
    if (limit !== undefined) {
      const page = workspaceId
        ? await context.get("services").chats.listPage(workspaceId, subject, {
            archived,
            limit,
            offset: offset ?? 0,
          })
        : { items: [], limit, offset: offset ?? 0, total: 0 };
      return context.json({
        data: page.items,
        meta: {
          limit: page.limit,
          offset: page.offset,
          total: page.total,
          hasMore: page.offset + page.items.length < page.total,
        },
      });
    }
    const data = workspaceId
      ? await context
          .get("services")
          .chats.list(workspaceId, subject, { archived })
      : [];
    return context.json({ data });
  });

  app.openapi(searchChatsRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const workspaceId = query.workspaceId ?? subject.workspaceIds[0] ?? "";
    const data = await context.get("services").chats.search({
      subject,
      workspaceId,
      query: query.q ?? "",
    });
    return context.json({ data });
  });

  app.openapi(importChatRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chats.importChat({
      subject,
      workspaceId: body.workspaceId,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
      messages: body.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.citations === undefined
          ? {}
          : {
              citations: message.citations.map((citation) => ({
                chunkId: citation.chunkId,
                documentId: citation.documentId,
                title: citation.title,
                ...(citation.sourceUri === undefined
                  ? {}
                  : { sourceUri: citation.sourceUri }),
                ...(citation.sourceType === undefined
                  ? {}
                  : { sourceType: citation.sourceType }),
                ...(citation.provider === undefined
                  ? {}
                  : { provider: citation.provider }),
                ...(citation.retrievedAt === undefined
                  ? {}
                  : { retrievedAt: citation.retrievedAt }),
                ...(citation.accessedAt === undefined
                  ? {}
                  : { accessedAt: citation.accessedAt }),
                ...(citation.publishedAt === undefined
                  ? {}
                  : { publishedAt: citation.publishedAt }),
              })),
            }),
        ...(message.attachments === undefined
          ? {}
          : {
              attachments: message.attachments.map((attachment) => ({
                dataBase64: attachment.dataBase64,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                ...(attachment.retainedInContext === undefined
                  ? {}
                  : { retainedInContext: attachment.retainedInContext }),
              })),
            }),
        ...(message.createdAt === undefined
          ? {}
          : { createdAt: message.createdAt }),
      })),
    });
    publishChatChange(context.get("services"), subject, data, "imported");
    return context.json({ data }, 201);
  });

  app.openapi(createChatRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chats.create({
      subject,
      workspaceId: body.workspaceId,
      title: body.title,
      ...(body.agentId === undefined ? {} : { agentId: body.agentId }),
      ...(body.temporary === undefined ? {} : { temporary: body.temporary }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
    });
    publishChatChange(context.get("services"), subject, data, "created");
    return context.json({ data }, 201);
  });

  app.openapi(getChatRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.get(context.req.valid("param").chatId, subject);
    return context.json({ data });
  });

  app.openapi(exportChatRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const { format } = context.req.valid("query");
    const data = await context.get("services").chats.exportChat({
      subject: context.get("subject"),
      chatId,
    });
    if (format === "html") {
      return new Response(renderChatExportHtml(data), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${safeExportName(data.chat.title)}.html"`,
          "x-content-type-options": "nosniff",
        },
      });
    }
    return context.json({ data });
  });

  app.openapi(updateChatRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chats.update({
      subject,
      chatId: context.req.valid("param").chatId,
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
    });
    publishChatChange(context.get("services"), subject, data, "updated");
    return context.json({ data });
  });

  app.openapi(previewDeleteChatRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").chats.deletePreview({
      subject,
      chatId: context.req.valid("param").chatId,
    });
    return context.json({ data });
  });

  app.openapi(deleteChatRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const chat = await context
      .get("services")
      .chats.get(context.req.valid("param").chatId, subject);
    const data = await context.get("services").chats.delete({
      subject,
      chatId: context.req.valid("param").chatId,
      confirmChatId: body.confirmChatId,
    });
    publishChatChange(context.get("services"), subject, chat, "deleted");
    return context.json({ data });
  });

  app.openapi(listMessagesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.messages(context.req.valid("param").chatId, subject);
    return context.json({ data });
  });

  app.openapi(deleteMessageRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const data = await context.get("services").chats.deleteMessage({
      subject,
      chatId: params.chatId,
      messageId: params.messageId,
    });
    return context.json({ data });
  });

  app.openapi(listMessageFeedbackRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.messageFeedbackList(context.req.valid("param").chatId, subject);
    return context.json({ data });
  });

  app.openapi(getMessageFeedbackRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const data = await context.get("services").chats.messageFeedback({
      subject,
      chatId: params.chatId,
      messageId: params.messageId,
    });
    return context.json({ data });
  });

  app.openapi(updateAttachmentRetentionRoute, async (context) => {
    const body = context.req.valid("json");
    const params = context.req.valid("param");
    const data = await context.get("services").chats.updateAttachmentRetention({
      subject: context.get("subject"),
      chatId: params.chatId,
      messageId: params.messageId,
      attachmentId: params.attachmentId,
      retainedInContext: body.retainedInContext,
    });
    return context.json({ data });
  });

  app.openapi(updateMessageFeedbackRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const params = context.req.valid("param");
    const data = await context.get("services").chats.updateMessageFeedback({
      subject,
      chatId: params.chatId,
      messageId: params.messageId,
      rating: body.rating,
      ...(body.reasonCode !== undefined ? { reasonCode: body.reasonCode } : {}),
    });
    return context.json({ data });
  });

  app.openapi(previewAttachmentRoute, async (context) => {
    const params = context.req.valid("param");
    const preview = await context
      .get("services")
      .chats.readAttachmentTextPreview({
        subject: context.get("subject"),
        chatId: params.chatId,
        messageId: params.messageId,
        attachmentId: params.attachmentId,
      });
    return context.text(preview.content, 200, {
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="${preview.fileName.replace(/"/gu, "")}"`,
      "content-security-policy": "default-src 'none'; frame-ancestors 'self'",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
  });

  app.openapi(readAttachmentRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const attachment = await context.get("services").chats.readAttachment({
      subject,
      chatId: params.chatId,
      messageId: params.messageId,
      attachmentId: params.attachmentId,
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
  });

  app.openapi(archiveChatRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chats.archive({ subject, chatId: context.req.valid("param").chatId });
    publishChatChange(context.get("services"), subject, data, "archived");
    return context.json({ data });
  });

  app.openapi(forkChatRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chats.fork({
      subject,
      chatId: context.req.valid("param").chatId,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.throughMessageId !== undefined
        ? { throughMessageId: body.throughMessageId }
        : {}),
      ...(body.includeAttachments !== undefined
        ? { includeAttachments: body.includeAttachments }
        : {}),
    });
    publishChatChange(context.get("services"), subject, data, "forked");
    return context.json({ data }, 201);
  });

  app.openapi(unarchiveChatRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").chats.unarchive({
      subject,
      chatId: context.req.valid("param").chatId,
    });
    publishChatChange(context.get("services"), subject, data, "unarchived");
    return context.json({ data });
  });

  app.openapi(updateChatLegalHoldRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chats.updateLegalHold({
      subject,
      chatId: context.req.valid("param").chatId,
      ...(body.legalHoldUntil !== undefined
        ? { legalHoldUntil: body.legalHoldUntil }
        : {}),
      ...(body.legalHoldReason !== undefined
        ? { legalHoldReason: body.legalHoldReason }
        : {}),
    });
    return context.json({ data });
  });

  app.openapi(listChatCommentsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .chatComments.list(subject, context.req.valid("param").chatId);
    return context.json({ data });
  });

  app.openapi(createChatCommentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").chatComments.create({
      subject,
      chatId: context.req.valid("param").chatId,
      body: body.body,
    });
    return context.json({ data }, 201);
  });
}

function publishChatChange(
  services: RomeoServices,
  subject: AuthSubject,
  chat: { id: string; workspaceId: string },
  action: import("../../services/chat-event-service").ChatChangeAction,
): void {
  services.chatEvents.publish({
    action,
    chatId: chat.id,
    orgId: subject.orgId,
    workspaceId: chat.workspaceId,
  });
}

function safeExportName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "conversation"
  );
}

function renderChatExportHtml(
  data: Awaited<
    ReturnType<import("../../services/chat-service").ChatService["exportChat"]>
  >,
): string {
  const messages = data.messages
    .map(
      (message) =>
        `<article><h2>${escapeHtml(message.role)}</h2><pre>${escapeHtml(message.content)}</pre></article>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(data.chat.title)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px}article{border-top:1px solid #ddd;padding:18px 0}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escapeHtml(data.chat.title)}</h1>${messages}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
