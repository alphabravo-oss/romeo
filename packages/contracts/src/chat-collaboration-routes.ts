import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ChatCommentSchema,
  ChatSchema,
  CreateChatCommentSchema,
  ForkChatSchema,
  UpdateChatLegalHoldSchema,
  chatIdentifier,
} from "./chat-schemas";

const chatPath = z.strictObject({ chatId: chatIdentifier });
const metadata = { tags: ["Chats"], security: authenticationSecurity };
const errors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;

function chatActionRoute(input: {
  operationId: string;
  path: string;
  summary: string;
}) {
  return createRoute({
    ...metadata,
    method: "post",
    path: input.path,
    operationId: input.operationId,
    summary: input.summary,
    request: { params: chatPath },
    responses: {
      200: jsonResponse("Chat", dataEnvelope(ChatSchema)),
      ...errors,
    },
  });
}

export const archiveChatRoute = chatActionRoute({
  path: "/api/v1/chats/{chatId}/archive",
  operationId: "chats.archive",
  summary: "Archive a chat",
});
export const unarchiveChatRoute = chatActionRoute({
  path: "/api/v1/chats/{chatId}/unarchive",
  operationId: "chats.unarchive",
  summary: "Restore an archived chat",
});

export const forkChatRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/fork",
  operationId: "chats.fork",
  summary: "Fork a chat history into a new chat",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: { "application/json": { schema: ForkChatSchema } },
    },
  },
  responses: {
    201: jsonResponse("Forked chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const updateChatLegalHoldRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/legal-hold",
  operationId: "chats.updateLegalHold",
  summary: "Update or clear a chat legal hold",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateChatLegalHoldSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const listChatCommentsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/comments",
  operationId: "chats.listComments",
  summary: "List comments for a chat",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "Chat comments",
      dataEnvelope(z.array(ChatCommentSchema)),
    ),
    ...errors,
  },
});

export const createChatCommentRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/comments",
  operationId: "chats.createComment",
  summary: "Create a chat comment",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: { "application/json": { schema: CreateChatCommentSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created chat comment", dataEnvelope(ChatCommentSchema)),
    ...errors,
  },
});
