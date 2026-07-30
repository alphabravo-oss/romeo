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
    theme: z.enum(["system", "light", "dark"]),
    locale: z.enum(["en", "es", "fr"]),
    fontSize: z.enum(["small", "medium", "large"]),
    density: z.enum(["comfortable", "compact"]),
    reducedMotion: z.boolean(),
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
