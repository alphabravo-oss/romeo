import { createRoute, z } from "@hono/zod-openapi";

import {
  archiveChatRoute,
  createChatCommentRoute,
  forkChatRoute,
  listChatCommentsRoute,
  unarchiveChatRoute,
  updateChatLegalHoldRoute,
} from "./chat-collaboration-routes";
import { streamChatEventsRoute } from "./chat-events";
import { listMessagePageRoute } from "./chat-message-page-route";
import { searchChatMessagesRoute } from "./chat-message-search-route";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

import {
  chatIdentifier,
  ChatSchema,
  MessageSchema,
  MessageFeedbackStateSchema,
  DataDeletionPreviewSchema,
  DataDeletionResultSchema,
  CreateChatSchema,
  UpdateChatSchema,
  ImportChatSchema,
  ChatExportSchema,
  UpdateMessageFeedbackSchema,
  UpdateAttachmentRetentionSchema,
} from "./chat-schemas";

export * from "./chat-schemas";
export * from "./chat-collaboration-routes";
export * from "./chat-events";
export * from "./chat-message-page-route";
export * from "./chat-message-search-route";

const chatPath = z.strictObject({ chatId: chatIdentifier });
const messagePath = z.strictObject({
  chatId: chatIdentifier,
  messageId: chatIdentifier,
});
const attachmentPath = messagePath.extend({ attachmentId: chatIdentifier });
const metadata = { tags: ["Chats"], security: authenticationSecurity };
const errors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;
const pageMeta = z.strictObject({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const cleanupExpiredChatsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/chats/cleanup-expired",
  operationId: "chats.cleanupExpired",
  summary: "Physically delete expired temporary chats",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({ workspaceId: chatIdentifier.optional() }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Temporary chat cleanup result",
      dataEnvelope(
        z.strictObject({
          deletedChatIds: z.array(chatIdentifier),
          skippedLegalHoldIds: z.array(chatIdentifier),
        }),
      ),
    ),
    ...errors,
  },
});

export const listChatsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats",
  operationId: "chats.list",
  summary: "List chats in a workspace",
  request: {
    query: z.strictObject({
      workspaceId: chatIdentifier.optional(),
      archived: z.enum(["active", "archived", "all"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Chats",
      z.strictObject({ data: z.array(ChatSchema), meta: pageMeta.optional() }),
    ),
    ...errors,
  },
});

export const searchChatsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/query",
  operationId: "chats.search",
  summary: "Search chat titles, messages, and attachment names",
  request: {
    query: z.strictObject({
      workspaceId: chatIdentifier.optional(),
      q: z.string().max(1_000).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Chat search results",
      dataEnvelope(
        z.array(
          ChatSchema.extend({
            match: z
              .strictObject({ messageId: chatIdentifier, snippet: z.string() })
              .optional(),
          }),
        ),
      ),
    ),
    ...errors,
  },
});

export const importChatRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/import",
  operationId: "chats.import",
  summary: "Import a portable conversation",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ImportChatSchema } },
    },
  },
  responses: {
    201: jsonResponse("Imported chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const createChatRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats",
  operationId: "chats.create",
  summary: "Create a chat",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateChatSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const getChatRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}",
  operationId: "chats.get",
  summary: "Get a chat",
  request: { params: chatPath },
  responses: {
    200: jsonResponse("Chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const exportChatRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/export",
  operationId: "chats.export",
  summary: "Export a portable conversation",
  request: {
    params: chatPath,
    query: z.strictObject({ format: z.enum(["json", "html"]).optional() }),
  },
  responses: {
    200: {
      description: "Portable conversation export",
      content: {
        "application/json": { schema: dataEnvelope(ChatExportSchema) },
        "text/html": { schema: z.string() },
      },
    },
    ...errors,
  },
});

export const updateChatRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/chats/{chatId}",
  operationId: "chats.update",
  summary: "Update chat metadata",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateChatSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const previewDeleteChatRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/delete-preview",
  operationId: "chats.previewDelete",
  summary: "Preview governed chat deletion",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "Data deletion preview",
      dataEnvelope(DataDeletionPreviewSchema),
    ),
    ...errors,
  },
});

export const deleteChatRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/chats/{chatId}",
  operationId: "chats.delete",
  summary: "Delete a chat through the governed deletion path",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .strictObject({ confirmChatId: chatIdentifier })
            .openapi("DeleteChatRequest"),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Data deletion result",
      dataEnvelope(DataDeletionResultSchema),
    ),
    ...errors,
  },
});

export const listMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/messages",
  operationId: "chats.listMessages",
  summary: "List messages for a chat",
  request: { params: chatPath },
  responses: {
    200: jsonResponse("Messages", dataEnvelope(z.array(MessageSchema))),
    ...errors,
  },
});

export const deleteMessageRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/chats/{chatId}/messages/{messageId}",
  operationId: "chats.deleteMessage",
  summary: "Delete a single chat message",
  request: { params: messagePath },
  responses: {
    200: jsonResponse("Deleted message", dataEnvelope(MessageSchema)),
    ...errors,
  },
});

export const listMessageFeedbackRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/message-feedback",
  operationId: "chats.listMessageFeedback",
  summary: "List caller feedback for assistant messages",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "Message feedback states",
      dataEnvelope(z.array(MessageFeedbackStateSchema)),
    ),
    ...errors,
  },
});

export const getMessageFeedbackRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/messages/{messageId}/feedback",
  operationId: "chats.getMessageFeedback",
  summary: "Get caller feedback for a message",
  request: { params: messagePath },
  responses: {
    200: jsonResponse(
      "Message feedback state",
      dataEnvelope(MessageFeedbackStateSchema),
    ),
    ...errors,
  },
});

export const updateMessageFeedbackRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/messages/{messageId}/feedback",
  operationId: "chats.updateMessageFeedback",
  summary: "Record or clear caller feedback for a message",
  request: {
    params: messagePath,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateMessageFeedbackSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Message feedback state",
      dataEnvelope(MessageFeedbackStateSchema),
    ),
    ...errors,
  },
});

export const updateAttachmentRetentionRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/chats/{chatId}/messages/{messageId}/attachments/{attachmentId}",
  operationId: "chats.updateAttachmentRetention",
  summary: "Retain or release an attachment from future turns",
  request: {
    params: attachmentPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateAttachmentRetentionSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated message attachment",
      dataEnvelope(
        z.strictObject({
          id: chatIdentifier,
          messageId: chatIdentifier,
          retainedInContext: z.boolean(),
        }),
      ),
    ),
    ...errors,
  },
});

export const readAttachmentRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/messages/{messageId}/attachments/{attachmentId}",
  operationId: "chats.readAttachment",
  summary: "Read an authorized message attachment",
  request: { params: attachmentPath },
  responses: {
    200: {
      description: "Message attachment bytes",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
    },
    ...errors,
  },
});

export const previewAttachmentRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/messages/{messageId}/attachments/{attachmentId}/preview",
  operationId: "chats.previewAttachment",
  summary: "Read a sanitized attachment text preview",
  request: { params: attachmentPath },
  responses: {
    200: {
      description: "Sanitized plain-text attachment preview",
      content: { "text/plain": { schema: z.string() } },
    },
    ...errors,
  },
});

export const chatRoutes = [
  cleanupExpiredChatsRoute,
  listChatsRoute,
  streamChatEventsRoute,
  searchChatsRoute,
  importChatRoute,
  createChatRoute,
  getChatRoute,
  exportChatRoute,
  updateChatRoute,
  previewDeleteChatRoute,
  deleteChatRoute,
  listMessagesRoute,
  listMessagePageRoute,
  searchChatMessagesRoute,
  deleteMessageRoute,
  listMessageFeedbackRoute,
  getMessageFeedbackRoute,
  updateMessageFeedbackRoute,
  updateAttachmentRetentionRoute,
  readAttachmentRoute,
  previewAttachmentRoute,
  archiveChatRoute,
  forkChatRoute,
  unarchiveChatRoute,
  updateChatLegalHoldRoute,
  listChatCommentsRoute,
  createChatCommentRoute,
] as const;
