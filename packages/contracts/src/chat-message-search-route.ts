import { createRoute, z } from "@hono/zod-openapi";

import { chatIdentifier, chatRole, chatTimestamp } from "./chat-schemas";
import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const searchChatMessagesRoute = createRoute({
  method: "get",
  path: "/api/v1/chats/{chatId}/messages/search",
  operationId: "chats.searchMessages",
  summary: "Search persisted messages within one authorized chat",
  tags: ["Chats"],
  security: authenticationSecurity,
  request: {
    params: z.strictObject({ chatId: chatIdentifier }),
    query: z.strictObject({
      cursor: z.string().min(1).max(2_000).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      q: z.string().trim().min(2).max(200),
    }),
  },
  responses: {
    200: jsonResponse(
      "Current-chat message search results",
      z.strictObject({
        data: z
          .array(
            z.strictObject({
              branch: z.enum(["active", "alternate"]),
              branchLeafMessageId: chatIdentifier,
              createdAt: chatTimestamp,
              messageId: chatIdentifier,
              role: chatRole,
              snippet: z.string().max(242),
            }),
          )
          .max(50),
        meta: z.strictObject({
          hasMore: z.boolean(),
          limit: z.number().int().min(1).max(50),
          nextCursor: z.string().max(2_000).optional(),
          total: z.number().int().nonnegative(),
          transcriptVersion: z.string().regex(/^[0-9]{1,20}$/u),
        }),
      }),
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    409: standardErrorResponses[409],
    500: standardErrorResponses[500],
  },
});
