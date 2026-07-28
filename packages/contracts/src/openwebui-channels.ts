import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  OpenWebUiChannelEventSchema,
  OpenWebUiChannelListItemResponseSchema,
  OpenWebUiChannelMemberActiveRequestSchema,
  OpenWebUiChannelMemberResponseSchema,
  OpenWebUiChannelMembersResponseSchema,
  OpenWebUiChannelMembersUpdateRequestSchema,
  OpenWebUiChannelMessagePinRequestSchema,
  OpenWebUiChannelMessageReactionRequestSchema,
  OpenWebUiChannelMessageRequestSchema,
  OpenWebUiChannelMessageResponseSchema,
  OpenWebUiChannelRequestSchema,
  OpenWebUiChannelResponseSchema,
  OpenWebUiUpdateChannelRequestSchema,
} from "./openwebui-channel-schemas";

const metadata = {
  tags: ["OpenWebUI compatibility"],
  security: authenticationSecurity,
};
const identifier = z.string().trim().min(1).max(300);
const channelPath = z.strictObject({ channelId: identifier });
const userPath = z.strictObject({ userId: identifier });
const messagePath = z.strictObject({
  channelId: identifier,
  messageId: identifier,
});
const messageQuery = z.strictObject({
  skip: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const pinnedQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
const memberQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  query: z.string().optional(),
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const channel = jsonResponse(
  "OpenWebUI-compatible channel",
  OpenWebUiChannelResponseSchema,
);
const message = jsonResponse(
  "OpenWebUI-compatible channel message",
  OpenWebUiChannelMessageResponseSchema,
);
const messages = jsonResponse(
  "OpenWebUI-compatible channel messages",
  z.array(OpenWebUiChannelMessageResponseSchema),
);
const booleanResponse = (description: string) =>
  jsonResponse(description, z.boolean());

export const listOpenWebUiChannelsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/",
  operationId: "openWebUi.listChannels",
  summary: "List OpenWebUI-compatible channels",
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible channels",
      z.array(OpenWebUiChannelListItemResponseSchema),
    ),
    ...standardErrorResponses,
  },
});
export const listOpenWebUiChannelsAliasRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/list",
  operationId: "openWebUi.listChannelsAlias",
  summary: "List OpenWebUI-compatible channels alias",
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible channels",
      z.array(OpenWebUiChannelListItemResponseSchema),
    ),
    ...standardErrorResponses,
  },
});
export const createOpenWebUiChannelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/create",
  operationId: "openWebUi.createChannel",
  summary: "Create an OpenWebUI-compatible channel",
  request: { body: body(OpenWebUiChannelRequestSchema) },
  responses: { 200: channel, ...standardErrorResponses },
});
export const getOrCreateOpenWebUiDmChannelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/users/{userId}",
  operationId: "openWebUi.getOrCreateDmChannel",
  summary: "Get or create an OpenWebUI-compatible DM channel",
  request: { params: userPath },
  responses: { 200: channel, ...standardErrorResponses },
});
export const streamOpenWebUiChannelEventsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/events",
  operationId: "openWebUi.streamChannelEvents",
  summary: "Stream OpenWebUI-compatible channel events",
  request: { params: channelPath },
  responses: {
    200: {
      description: "OpenWebUI-compatible channel event stream",
      content: {
        "text/event-stream": { schema: z.string() },
        "application/json": { schema: OpenWebUiChannelEventSchema },
      },
    },
    ...standardErrorResponses,
  },
});
export const listOpenWebUiChannelMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/messages",
  operationId: "openWebUi.listChannelMessages",
  summary: "List OpenWebUI-compatible channel messages",
  request: { params: channelPath, query: messageQuery },
  responses: { 200: messages, ...standardErrorResponses },
});
export const postOpenWebUiChannelMessageRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/post",
  operationId: "openWebUi.postChannelMessage",
  summary: "Post an OpenWebUI-compatible channel message",
  request: {
    params: channelPath,
    body: body(OpenWebUiChannelMessageRequestSchema),
  },
  responses: { 200: message, ...standardErrorResponses },
});
export const markOpenWebUiChannelReadRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/read",
  operationId: "openWebUi.markChannelRead",
  summary: "Mark an OpenWebUI-compatible channel as read",
  request: { params: channelPath },
  responses: {
    200: booleanResponse("Channel read state updated"),
    ...standardErrorResponses,
  },
});
export const listPinnedOpenWebUiChannelMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/messages/pinned",
  operationId: "openWebUi.listPinnedChannelMessages",
  summary: "List pinned OpenWebUI-compatible channel messages",
  request: { params: channelPath, query: pinnedQuery },
  responses: { 200: messages, ...standardErrorResponses },
});
export const getOpenWebUiChannelMessageRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/messages/{messageId}",
  operationId: "openWebUi.getChannelMessage",
  summary: "Get an OpenWebUI-compatible channel message",
  request: { params: messagePath },
  responses: { 200: message, ...standardErrorResponses },
});
export const getOpenWebUiChannelMessageDataRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/data",
  operationId: "openWebUi.getChannelMessageData",
  summary: "Get OpenWebUI-compatible channel message data",
  request: { params: messagePath },
  responses: {
    200: jsonResponse(
      "Channel message data",
      z.union([z.record(z.string(), z.unknown()), z.null()]),
    ),
    ...standardErrorResponses,
  },
});
export const listOpenWebUiChannelThreadMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/thread",
  operationId: "openWebUi.listChannelThreadMessages",
  summary: "List OpenWebUI-compatible channel thread replies",
  request: { params: messagePath, query: messageQuery },
  responses: { 200: messages, ...standardErrorResponses },
});
export const pinOpenWebUiChannelMessageRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/pin",
  operationId: "openWebUi.pinChannelMessage",
  summary: "Pin or unpin an OpenWebUI-compatible channel message",
  request: {
    params: messagePath,
    body: body(OpenWebUiChannelMessagePinRequestSchema),
  },
  responses: { 200: message, ...standardErrorResponses },
});
export const updateOpenWebUiChannelMessageRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/update",
  operationId: "openWebUi.updateChannelMessage",
  summary: "Update an OpenWebUI-compatible channel message",
  request: {
    params: messagePath,
    body: body(OpenWebUiChannelMessageRequestSchema),
  },
  responses: { 200: message, ...standardErrorResponses },
});
export const addOpenWebUiChannelMessageReactionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/reactions/add",
  operationId: "openWebUi.addChannelMessageReaction",
  summary: "Add an OpenWebUI-compatible channel message reaction",
  request: {
    params: messagePath,
    body: body(OpenWebUiChannelMessageReactionRequestSchema),
  },
  responses: {
    200: booleanResponse("Reaction added"),
    ...standardErrorResponses,
  },
});
export const removeOpenWebUiChannelMessageReactionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/reactions/remove",
  operationId: "openWebUi.removeChannelMessageReaction",
  summary: "Remove an OpenWebUI-compatible channel message reaction",
  request: {
    params: messagePath,
    body: body(OpenWebUiChannelMessageReactionRequestSchema),
  },
  responses: {
    200: booleanResponse("Reaction removed"),
    ...standardErrorResponses,
  },
});
export const deleteOpenWebUiChannelMessageRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/channels/{channelId}/messages/{messageId}/delete",
  operationId: "openWebUi.deleteChannelMessage",
  summary: "Delete an OpenWebUI-compatible channel message",
  request: { params: messagePath },
  responses: {
    200: booleanResponse("Channel message deleted"),
    ...standardErrorResponses,
  },
});
export const getOpenWebUiChannelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}",
  operationId: "openWebUi.getChannel",
  summary: "Get an OpenWebUI-compatible channel",
  request: { params: channelPath },
  responses: { 200: channel, ...standardErrorResponses },
});
export const listOpenWebUiChannelMembersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/channels/{channelId}/members",
  operationId: "openWebUi.listChannelMembers",
  summary: "List OpenWebUI-compatible channel members",
  request: { params: channelPath, query: memberQuery },
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible channel members",
      OpenWebUiChannelMembersResponseSchema,
    ),
    ...standardErrorResponses,
  },
});
export const updateOpenWebUiChannelMemberActiveRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/members/active",
  operationId: "openWebUi.updateChannelMemberActive",
  summary: "Update current OpenWebUI-compatible channel active state",
  request: {
    params: channelPath,
    body: body(OpenWebUiChannelMemberActiveRequestSchema),
  },
  responses: {
    200: booleanResponse("Channel active state updated"),
    ...standardErrorResponses,
  },
});
export const addOpenWebUiChannelMembersRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/update/members/add",
  operationId: "openWebUi.addChannelMembers",
  summary: "Add OpenWebUI-compatible channel members",
  request: {
    params: channelPath,
    body: body(OpenWebUiChannelMembersUpdateRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible channel members",
      z.array(OpenWebUiChannelMemberResponseSchema),
    ),
    ...standardErrorResponses,
  },
});
export const removeOpenWebUiChannelMembersRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/update/members/remove",
  operationId: "openWebUi.removeChannelMembers",
  summary: "Remove OpenWebUI-compatible channel members",
  request: {
    params: channelPath,
    body: body(OpenWebUiChannelMembersUpdateRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Removed channel member count",
      z.number().int().nonnegative(),
    ),
    ...standardErrorResponses,
  },
});
export const updateOpenWebUiChannelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/channels/{channelId}/update",
  operationId: "openWebUi.updateChannel",
  summary: "Update an OpenWebUI-compatible channel",
  request: {
    params: channelPath,
    body: body(OpenWebUiUpdateChannelRequestSchema),
  },
  responses: { 200: channel, ...standardErrorResponses },
});
export const deleteOpenWebUiChannelRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/channels/{channelId}/delete",
  operationId: "openWebUi.deleteChannel",
  summary: "Delete an OpenWebUI-compatible channel",
  request: { params: channelPath },
  responses: {
    200: booleanResponse("OpenWebUI-compatible delete result"),
    ...standardErrorResponses,
  },
});

export const openWebUiChannelRoutes = [
  listOpenWebUiChannelsRoute,
  listOpenWebUiChannelsAliasRoute,
  createOpenWebUiChannelRoute,
  getOrCreateOpenWebUiDmChannelRoute,
  streamOpenWebUiChannelEventsRoute,
  listOpenWebUiChannelMessagesRoute,
  postOpenWebUiChannelMessageRoute,
  markOpenWebUiChannelReadRoute,
  listPinnedOpenWebUiChannelMessagesRoute,
  getOpenWebUiChannelMessageRoute,
  getOpenWebUiChannelMessageDataRoute,
  listOpenWebUiChannelThreadMessagesRoute,
  pinOpenWebUiChannelMessageRoute,
  updateOpenWebUiChannelMessageRoute,
  addOpenWebUiChannelMessageReactionRoute,
  removeOpenWebUiChannelMessageReactionRoute,
  deleteOpenWebUiChannelMessageRoute,
  getOpenWebUiChannelRoute,
  listOpenWebUiChannelMembersRoute,
  updateOpenWebUiChannelMemberActiveRoute,
  addOpenWebUiChannelMembersRoute,
  removeOpenWebUiChannelMembersRoute,
  updateOpenWebUiChannelRoute,
  deleteOpenWebUiChannelRoute,
] as const;
