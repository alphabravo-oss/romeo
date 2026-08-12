import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const InterfacePreferencesSchema = z
  .strictObject({
    defaultAgentByWorkspace: z.record(z.string(), z.string()),
    /** Explicit user default base model, keyed by workspace id. */
    defaultModelByWorkspace: z.record(z.string(), z.string()),
    /** Soft fallback: last model the user selected, keyed by workspace id. */
    lastModelByWorkspace: z.record(z.string(), z.string()),
    theme: z.enum(["system", "light", "dark"]),
    locale: z.enum(["en", "es", "fr"]),
    fontSize: z.enum(["small", "medium", "large"]),
    density: z.enum(["comfortable", "compact"]),
    reducedMotion: z.boolean(),
    /** Suggested next-message chips under the last assistant reply (opt-in). */
    showFollowUps: z.boolean(),
    /** Empty-chat starter prompt cards. */
    showStarterPrompts: z.boolean(),
    /** "Continue generating" under the last assistant reply (opt-in). */
    showContinueButton: z.boolean(),
    /** Enter sends; Shift+Enter for newline. When false, Ctrl/Cmd+Enter sends. */
    enterToSend: z.boolean(),
    /** Auto-scroll the transcript while streaming when near the bottom. */
    stickToBottom: z.boolean(),
    /** Live wait/tool status stack above a streaming answer. */
    showRunStatus: z.boolean(),
    /** Base model name chip on assistant messages. */
    showMessageModelLabel: z.boolean(),
    /** Message timestamps under assistant turns. */
    showMessageTimestamps: z.boolean(),
  })
  .openapi("InterfacePreferences");

export const UpdateInterfacePreferencesSchema =
  InterfacePreferencesSchema.partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one interface preference is required.",
    })
    .openapi("UpdateInterfacePreferencesRequest");

export const InterfacePreferencesResponseSchema = dataEnvelope(
  InterfacePreferencesSchema,
).openapi("InterfacePreferencesResponse");

export const getInterfacePreferencesRoute = createRoute({
  method: "get",
  path: "/api/v1/me/interface-preferences",
  operationId: "interfacePreferences.getCurrent",
  tags: ["Interface Preferences"],
  summary: "Read synchronized interface preferences",
  description:
    "Returns the current principal's server-synchronized appearance and accessibility preferences.",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Interface preferences",
      InterfacePreferencesResponseSchema,
    ),
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});

export const updateInterfacePreferencesRoute = createRoute({
  method: "patch",
  path: "/api/v1/me/interface-preferences",
  operationId: "interfacePreferences.updateCurrent",
  tags: ["Interface Preferences"],
  summary: "Update synchronized interface preferences",
  description:
    "Updates one or more allowed appearance or accessibility preferences for the current principal.",
  security: authenticationSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateInterfacePreferencesSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Interface preferences",
      InterfacePreferencesResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});
