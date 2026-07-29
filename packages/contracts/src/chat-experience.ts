import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { ChatSchema, chatIdentifier } from "./chat-schemas";

export const ChatSuggestionSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(4_000),
  })
  .openapi("ChatSuggestion");

export const ChatExperienceSchema = z
  .strictObject({
    suggestions: z.array(ChatSuggestionSchema).max(8),
    autoTitleEnabled: z.boolean(),
  })
  .openapi("ChatExperience");

export const UpdateChatExperienceSchema = ChatExperienceSchema.openapi(
  "UpdateChatExperienceRequest",
);

const errors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
  502: errorResponse,
  503: errorResponse,
} as const;

export const getChatExperienceRoute = createRoute({
  method: "get",
  path: "/api/v1/chat-experience",
  operationId: "chatExperience.get",
  tags: ["Chat Experience"],
  summary: "Read organization chat experience settings",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Chat experience", dataEnvelope(ChatExperienceSchema)),
    ...errors,
  },
});

export const updateChatExperienceRoute = createRoute({
  method: "put",
  path: "/api/v1/admin/chat-experience",
  operationId: "chatExperience.update",
  tags: ["Chat Experience"],
  summary: "Update organization chat experience settings",
  security: authenticationSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: UpdateChatExperienceSchema } },
    },
  },
  responses: {
    200: jsonResponse("Chat experience", dataEnvelope(ChatExperienceSchema)),
    ...errors,
  },
});

export const generateChatTitleRoute = createRoute({
  method: "post",
  path: "/api/v1/chats/{chatId}/generate-title",
  operationId: "chatExperience.generateTitle",
  tags: ["Chat Experience"],
  summary: "Generate a concise title for a chat",
  security: authenticationSecurity,
  request: {
    params: z.strictObject({ chatId: chatIdentifier }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            modelId: z.string().trim().min(1).max(200),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated chat", dataEnvelope(ChatSchema)),
    ...errors,
  },
});

export const chatExperienceRoutes = [
  getChatExperienceRoute,
  updateChatExperienceRoute,
  generateChatTitleRoute,
] as const;

export type ChatExperience = z.infer<typeof ChatExperienceSchema>;
export type ChatSuggestion = z.infer<typeof ChatSuggestionSchema>;
