import { createRoute, z } from "@hono/zod-openapi";

import { chatIdentifier, MessageSchema } from "./chat-schemas";
import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const listMessagePageRoute = createRoute({
  method: "get",
  path: "/api/v1/chats/{chatId}/messages/page",
  operationId: "chats.listMessagePage",
  summary: "Page upward through the selected chat branch",
  tags: ["Chats"],
  security: authenticationSecurity,
  request: {
    params: z.strictObject({ chatId: chatIdentifier }),
    query: z.strictObject({
      branchLeafMessageId: chatIdentifier.optional(),
      cursor: z.string().min(1).max(2_000).optional(),
      direction: z.literal("older"),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Active-branch message page",
      z.strictObject({
        data: z.array(MessageSchema).max(100),
        meta: z.strictObject({
          activeBranchChanged: z.boolean(),
          branchVariants: z
            .array(
              z.strictObject({
                index: z.number().int().nonnegative(),
                messageId: chatIdentifier,
                nextLeafMessageId: chatIdentifier.optional(),
                previousLeafMessageId: chatIdentifier.optional(),
                total: z.number().int().min(2),
              }),
            )
            .max(100),
          branchLeafMessageId: chatIdentifier.optional(),
          currentActiveLeafMessageId: chatIdentifier.optional(),
          direction: z.literal("older"),
          hasOlder: z.boolean(),
          limit: z.number().int().min(1).max(100),
          mode: z.enum(["branch", "linear"]),
          olderCursor: z.string().max(2_000).optional(),
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
