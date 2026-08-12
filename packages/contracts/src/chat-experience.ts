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
    // Off means the chat answers as the selected model. Runs are still recorded against a managed
    // model version, so the audit trail and its safety settings survive either way.
    assistantsEnabled: z.boolean(),
  })
  .openapi("ChatExperience");

// Spread rather than `.extend()`: extending a registered schema emits an `allOf` against the
// ChatExperience component, which would keep the field required through the $ref.
export const UpdateChatExperienceSchema = z
  .strictObject({
    ...ChatExperienceSchema.shape,
    // Optional on the request only — the read schema still guarantees it. A client built before
    // this field existed PUTs the old body, and requiring it would 400 every one of them. Omitting
    // the field means "leave the stored control alone", never "turn assistants off": a settings
    // write must not silently flip a switch it never sent.
    assistantsEnabled: z.boolean().optional(),
  })
  .openapi("UpdateChatExperienceRequest");

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
export type UpdateChatExperience = z.infer<typeof UpdateChatExperienceSchema>;
export type ChatSuggestion = z.infer<typeof ChatSuggestionSchema>;
