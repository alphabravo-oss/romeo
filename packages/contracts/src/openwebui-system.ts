import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const booleanRecord = z.record(z.string(), z.boolean());
const OpenWebUiPermissionsSchema = z.strictObject({
  workspace: booleanRecord,
  features: booleanRecord,
  chat: booleanRecord,
  sharing: booleanRecord,
  settings: booleanRecord,
  access_grants: booleanRecord,
});
const featureFlags = z
  .strictObject({
    auth: z.boolean(),
    auth_trusted_header: z.boolean(),
    enable_signup_password_confirmation: z.boolean(),
    enable_ldap: z.boolean(),
    enable_signup: z.boolean(),
    enable_login_form: z.boolean(),
    enable_websocket: z.boolean(),
    enable_api_keys: z.boolean(),
    enable_password_change_form: z.boolean(),
    enable_version_update_check: z.boolean(),
    enable_public_active_users_count: z.boolean(),
    enable_easter_eggs: z.boolean(),
    enable_direct_connections: z.boolean(),
    enable_folders: z.boolean(),
    folder_max_file_count: z.number().int().nonnegative(),
    enable_channels: z.boolean(),
    enable_calendar: z.boolean(),
    enable_automations: z.boolean(),
    enable_notes: z.boolean(),
    enable_web_search: z.boolean(),
    enable_code_execution: z.literal(false),
    enable_code_interpreter: z.literal(false),
    enable_image_generation: z.boolean(),
    enable_autocomplete_generation: z.boolean(),
    enable_community_sharing: z.boolean(),
    enable_message_rating: z.boolean(),
    enable_user_webhooks: z.boolean(),
    enable_user_status: z.boolean(),
    enable_admin_export: z.boolean(),
    enable_admin_chat_access: z.boolean(),
    enable_admin_analytics: z.boolean(),
    enable_google_drive_integration: z.boolean(),
    enable_onedrive_integration: z.boolean(),
    enable_memories: z.boolean(),
  })
  .openapi("OpenWebUiFeatureFlags");

export const OpenWebUiConfigResponseSchema = z
  .strictObject({
    status: z.literal(true),
    name: z.string(),
    version: z.string(),
    default_locale: z.string(),
    oauth: z.strictObject({
      providers: z.record(z.string(), z.unknown()),
      auto_redirect: z.boolean(),
    }),
    features: featureFlags,
    default_models: z.array(z.string()),
    default_pinned_models: z.array(z.string()),
    default_prompt_suggestions: z.array(z.unknown()),
    code: z.strictObject({
      engine: z.string(),
      interpreter_engine: z.string(),
    }),
    audio: z.strictObject({
      tts: z.strictObject({
        engine: z.string(),
        voice: z.string(),
        split_on: z.string(),
      }),
      stt: z.strictObject({ engine: z.string() }),
    }),
    file: z.strictObject({
      max_size: z.number().int().positive(),
      max_count: z.number().int().positive(),
      image_compression: z.strictObject({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    }),
    permissions: z.record(z.string(), z.unknown()),
    ui: z.strictObject({
      pending_user_overlay_title: z.string(),
      pending_user_overlay_content: z.string(),
      response_watermark: z.string(),
      iframe_csp: z.string(),
    }),
    license_metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi("OpenWebUiConfigResponse");
export const OpenWebUiVersionResponseSchema = z
  .strictObject({ version: z.string(), deployment_id: z.string() })
  .openapi("OpenWebUiVersionResponse");
export const OpenWebUiVersionUpdatesResponseSchema = z
  .strictObject({ current: z.string(), latest: z.string() })
  .openapi("OpenWebUiVersionUpdatesResponse");
export const OpenWebUiSessionUserResponseSchema = z
  .strictObject({
    token: z.null(),
    token_type: z.literal("Bearer"),
    expires_at: z.null(),
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(["admin", "user"]),
    profile_image_url: z.string(),
    permissions: OpenWebUiPermissionsSchema,
    bio: z.null(),
    gender: z.null(),
    date_of_birth: z.null(),
    status_emoji: z.string(),
    status_message: z.string(),
    status_expires_at: z.null(),
  })
  .openapi("OpenWebUiSessionUserResponse");

export type OpenWebUiConfigResponse = z.infer<
  typeof OpenWebUiConfigResponseSchema
>;
export type OpenWebUiVersionResponse = z.infer<
  typeof OpenWebUiVersionResponseSchema
>;
export type OpenWebUiVersionUpdatesResponse = z.infer<
  typeof OpenWebUiVersionUpdatesResponseSchema
>;
export type OpenWebUiSessionUserResponse = z.infer<
  typeof OpenWebUiSessionUserResponseSchema
>;

const sessionResponse = jsonResponse(
  "OpenWebUI-compatible session user",
  OpenWebUiSessionUserResponseSchema,
);
const configResponse = jsonResponse(
  "OpenWebUI-compatible configuration",
  OpenWebUiConfigResponseSchema,
);
const versionResponse = jsonResponse(
  "OpenWebUI-compatible version",
  OpenWebUiVersionResponseSchema,
);
const updatesResponse = jsonResponse(
  "OpenWebUI-compatible version update status",
  OpenWebUiVersionUpdatesResponseSchema,
);

export const getOpenWebUiSessionUserRoute = createRoute({
  method: "get",
  path: "/api/v1/auths/",
  operationId: "openWebUi.getSessionUser",
  tags: ["OpenWebUI compatibility"],
  security: authenticationSecurity,
  summary: "Get the OpenWebUI-compatible session user",
  responses: { 200: sessionResponse, ...standardErrorResponses },
});

const tags = ["OpenWebUI compatibility"];
export const getOpenWebUiConfigRoute = createRoute({
  method: "get",
  path: "/api/v1/openwebui/config",
  operationId: "openWebUi.getConfig",
  tags,
  security: [],
  summary: "Get OpenWebUI-compatible configuration",
  responses: { 200: configResponse, ...standardErrorResponses },
});
export const getOpenWebUiVersionRoute = createRoute({
  method: "get",
  path: "/api/v1/openwebui/version",
  operationId: "openWebUi.getVersion",
  tags,
  security: [],
  summary: "Get the OpenWebUI-compatible version",
  responses: { 200: versionResponse, ...standardErrorResponses },
});
export const getOpenWebUiVersionUpdatesRoute = createRoute({
  method: "get",
  path: "/api/v1/openwebui/version/updates",
  operationId: "openWebUi.getVersionUpdates",
  tags,
  security: [],
  summary: "Get OpenWebUI-compatible version update status",
  responses: { 200: updatesResponse, ...standardErrorResponses },
});
export const getOpenWebUiConfigAliasRoute = createRoute({
  method: "get",
  path: "/api/config",
  operationId: "openWebUi.getConfigAlias",
  tags,
  security: authenticationSecurity,
  servers: [{ url: "/" }],
  summary: "Get configuration through the legacy OpenWebUI alias",
  responses: { 200: configResponse, ...standardErrorResponses },
});
export const getOpenWebUiVersionAliasRoute = createRoute({
  method: "get",
  path: "/api/version",
  operationId: "openWebUi.getVersionAlias",
  tags,
  security: authenticationSecurity,
  servers: [{ url: "/" }],
  summary: "Get version through the legacy OpenWebUI alias",
  responses: { 200: versionResponse, ...standardErrorResponses },
});
export const getOpenWebUiVersionUpdatesAliasRoute = createRoute({
  method: "get",
  path: "/api/version/updates",
  operationId: "openWebUi.getVersionUpdatesAlias",
  tags,
  security: authenticationSecurity,
  servers: [{ url: "/" }],
  summary: "Get version updates through the legacy OpenWebUI alias",
  responses: { 200: updatesResponse, ...standardErrorResponses },
});

export const openWebUiSystemRoutes = [
  getOpenWebUiSessionUserRoute,
  getOpenWebUiConfigRoute,
  getOpenWebUiVersionRoute,
  getOpenWebUiVersionUpdatesRoute,
  getOpenWebUiConfigAliasRoute,
  getOpenWebUiVersionAliasRoute,
  getOpenWebUiVersionUpdatesAliasRoute,
] as const;
