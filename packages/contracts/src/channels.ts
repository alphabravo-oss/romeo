import { createRoute, z } from "@hono/zod-openapi";

import {
  AddChannelMembersRequestSchema,
  ChannelEventSchema,
  ChannelMemberRemovalResultSchema,
  ChannelMemberSchema,
  ChannelMessageDeletionResultSchema,
  ChannelMessageReactionRequestSchema,
  ChannelMessageSchema,
  ChannelSchema,
  CreateChannelMessageRequestSchema,
  CreateChannelRequestSchema,
  CreateDirectMessageChannelRequestSchema,
  PinChannelMessageRequestSchema,
  UpdateChannelRequestSchema,
  channelIdParams,
  channelMemberParams,
  channelMessageParams,
  channelPaginationQuery,
  channelReactionParams,
} from "./channel-schemas";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export * from "./channel-schemas";

const metadata = { tags: ["Channels"], security: authenticationSecurity };
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const channelResponse = jsonResponse("Channel", dataEnvelope(ChannelSchema));
const messageResponse = jsonResponse(
  "Channel message",
  dataEnvelope(ChannelMessageSchema),
);
const messageListResponse = jsonResponse(
  "Channel messages",
  dataEnvelope(z.array(ChannelMessageSchema)),
);

export const listChannelsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels",
  operationId: "channels.list",
  summary: "List native collaboration channels",
  responses: {
    200: jsonResponse("Channels", dataEnvelope(z.array(ChannelSchema))),
    ...standardErrorResponses,
  },
});
export const createChannelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels",
  operationId: "channels.create",
  summary: "Create a native collaboration channel",
  request: { body: body(CreateChannelRequestSchema) },
  responses: { 201: channelResponse, ...standardErrorResponses },
});
export const createDirectMessageChannelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/direct-messages",
  operationId: "channels.createDirectMessage",
  summary: "Get or create a direct-message channel",
  request: { body: body(CreateDirectMessageChannelRequestSchema) },
  responses: { 201: channelResponse, ...standardErrorResponses },
});
export const getChannelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}",
  operationId: "channels.get",
  summary: "Get a native collaboration channel",
  request: { params: channelIdParams },
  responses: { 200: channelResponse, ...standardErrorResponses },
});
export const updateChannelRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/collaboration/channels/{channelId}",
  operationId: "channels.update",
  summary: "Update a native collaboration channel",
  request: { params: channelIdParams, body: body(UpdateChannelRequestSchema) },
  responses: { 200: channelResponse, ...standardErrorResponses },
});
export const deleteChannelRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/channels/{channelId}",
  operationId: "channels.delete",
  summary: "Delete a native collaboration channel",
  request: { params: channelIdParams },
  responses: { 200: channelResponse, ...standardErrorResponses },
});
export const streamChannelEventsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/events",
  operationId: "channels.streamEvents",
  summary: "Stream native channel events",
  request: { params: channelIdParams },
  responses: {
    200: {
      description: "SSE stream carrying ChannelEvent frames",
      content: {
        "text/event-stream": { schema: z.string() },
        "application/json": { schema: ChannelEventSchema },
      },
    },
    ...standardErrorResponses,
  },
});
export const listChannelMembersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/members",
  operationId: "channels.listMembers",
  summary: "List channel members",
  request: { params: channelIdParams },
  responses: {
    200: jsonResponse(
      "Channel members",
      dataEnvelope(z.array(ChannelMemberSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const addChannelMembersRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/{channelId}/members",
  operationId: "channels.addMembers",
  summary: "Add channel members",
  request: {
    params: channelIdParams,
    body: body(AddChannelMembersRequestSchema),
  },
  responses: {
    201: jsonResponse(
      "Added channel members",
      dataEnvelope(z.array(ChannelMemberSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const removeChannelMemberRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/channels/{channelId}/members/{userId}",
  operationId: "channels.removeMember",
  summary: "Remove a channel member",
  request: { params: channelMemberParams },
  responses: {
    200: jsonResponse(
      "Channel member removal",
      dataEnvelope(ChannelMemberRemovalResultSchema),
    ),
    ...standardErrorResponses,
  },
});
export const listChannelMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/messages",
  operationId: "channels.listMessages",
  summary: "List channel messages",
  request: { params: channelIdParams, query: channelPaginationQuery },
  responses: { 200: messageListResponse, ...standardErrorResponses },
});
export const createChannelMessageRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/{channelId}/messages",
  operationId: "channels.createMessage",
  summary: "Post a channel message",
  request: {
    params: channelIdParams,
    body: body(CreateChannelMessageRequestSchema),
  },
  responses: { 201: messageResponse, ...standardErrorResponses },
});
export const markChannelReadRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/{channelId}/read",
  operationId: "channels.markRead",
  summary: "Mark a channel as read",
  request: { params: channelIdParams },
  responses: { 200: channelResponse, ...standardErrorResponses },
});
export const listPinnedChannelMessagesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/messages/pinned",
  operationId: "channels.listPinnedMessages",
  summary: "List pinned channel messages",
  request: {
    params: channelIdParams,
    query: z.strictObject({ page: z.coerce.number().int().min(1).optional() }),
  },
  responses: { 200: messageListResponse, ...standardErrorResponses },
});
export const getChannelMessageRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}",
  operationId: "channels.getMessage",
  summary: "Get a channel message",
  request: { params: channelMessageParams },
  responses: { 200: messageResponse, ...standardErrorResponses },
});
export const updateChannelMessageRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}",
  operationId: "channels.updateMessage",
  summary: "Update a channel message",
  request: {
    params: channelMessageParams,
    body: body(CreateChannelMessageRequestSchema),
  },
  responses: { 200: messageResponse, ...standardErrorResponses },
});
export const deleteChannelMessageRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}",
  operationId: "channels.deleteMessage",
  summary: "Delete a channel message",
  request: { params: channelMessageParams },
  responses: {
    200: jsonResponse(
      "Deleted channel message",
      dataEnvelope(ChannelMessageDeletionResultSchema),
    ),
    ...standardErrorResponses,
  },
});
export const listChannelThreadRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/thread",
  operationId: "channels.listThread",
  summary: "List channel thread replies",
  request: { params: channelMessageParams, query: channelPaginationQuery },
  responses: { 200: messageListResponse, ...standardErrorResponses },
});
export const pinChannelMessageRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/pin",
  operationId: "channels.pinMessage",
  summary: "Pin or unpin a channel message",
  request: {
    params: channelMessageParams,
    body: body(PinChannelMessageRequestSchema),
  },
  responses: { 200: messageResponse, ...standardErrorResponses },
});
export const addChannelReactionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/reactions",
  operationId: "channels.addReaction",
  summary: "Add a channel message reaction",
  request: {
    params: channelMessageParams,
    body: body(ChannelMessageReactionRequestSchema),
  },
  responses: { 201: messageResponse, ...standardErrorResponses },
});
export const removeChannelReactionRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/reactions/{name}",
  operationId: "channels.removeReaction",
  summary: "Remove a channel message reaction",
  request: { params: channelReactionParams },
  responses: { 200: messageResponse, ...standardErrorResponses },
});

export const channelRoutes = [
  listChannelsRoute,
  createChannelRoute,
  createDirectMessageChannelRoute,
  getChannelRoute,
  updateChannelRoute,
  deleteChannelRoute,
  streamChannelEventsRoute,
  listChannelMembersRoute,
  addChannelMembersRoute,
  removeChannelMemberRoute,
  listChannelMessagesRoute,
  createChannelMessageRoute,
  markChannelReadRoute,
  listPinnedChannelMessagesRoute,
  getChannelMessageRoute,
  updateChannelMessageRoute,
  deleteChannelMessageRoute,
  listChannelThreadRoute,
  pinChannelMessageRoute,
  addChannelReactionRoute,
  removeChannelReactionRoute,
] as const;
