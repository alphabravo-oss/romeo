import { createRoute, z } from "@hono/zod-openapi";

import { chatIdentifier, chatTimestamp } from "./chat-schemas";
import { authenticationSecurity, standardErrorResponses } from "./common";

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    id: chatIdentifier,
    type: z.literal("connected"),
    workspaceId: chatIdentifier,
    createdAt: chatTimestamp,
  }),
  z.strictObject({
    id: chatIdentifier,
    type: z.literal("changed"),
    action: z.enum([
      "archived",
      "created",
      "deleted",
      "forked",
      "imported",
      "unarchived",
      "updated",
    ]),
    chatId: chatIdentifier,
    workspaceId: chatIdentifier,
    createdAt: chatTimestamp,
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const streamChatEventsRoute = createRoute({
  tags: ["Chats"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/workspaces/{workspaceId}/chat-events",
  operationId: "chats.streamEvents",
  summary: "Stream workspace chat collection changes",
  request: {
    params: z.strictObject({ workspaceId: chatIdentifier }),
  },
  responses: {
    200: {
      description: "SSE stream carrying ChatEvent frames",
      content: {
        "text/event-stream": { schema: z.string() },
        "application/json": { schema: ChatEventSchema },
      },
    },
    ...standardErrorResponses,
  },
});
