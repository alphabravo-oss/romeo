import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const jsonObject = z.record(z.string(), z.unknown());
const epoch = z.number().int().nonnegative();

export const OpenWebUiChannelUserResponseSchema = z
  .strictObject({
    id: identifier,
    email: z.email(),
    name: z.string(),
    role: z.enum(["admin", "user"]),
    profile_image_url: z.string(),
    is_active: z.boolean(),
    status_emoji: z.string(),
    status_message: z.string(),
    status_expires_at: z.null(),
  })
  .openapi("OpenWebUiChannelUserResponse");

export const OpenWebUiChannelListItemResponseSchema = z
  .strictObject({
    id: identifier,
    user_id: identifier,
    type: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    is_private: z.boolean().nullable(),
    data: jsonObject.nullable(),
    meta: jsonObject.nullable(),
    access_grants: z.array(z.unknown()),
    created_at: epoch,
    updated_at: epoch,
    updated_by: identifier.nullable(),
    archived_at: epoch.nullable(),
    archived_by: identifier.nullable(),
    deleted_at: epoch.nullable(),
    deleted_by: identifier.nullable(),
    last_message_at: epoch.nullable(),
    unread_count: z.number().int().nonnegative(),
    user_ids: z.array(identifier).optional(),
    users: z.array(OpenWebUiChannelUserResponseSchema).optional(),
  })
  .openapi("OpenWebUiChannelListItemResponse");

export const OpenWebUiChannelResponseSchema =
  OpenWebUiChannelListItemResponseSchema.extend({
    is_manager: z.boolean(),
    write_access: z.boolean(),
    user_count: z.number().int().nonnegative().nullable(),
    last_read_at: epoch.nullable(),
  }).openapi("OpenWebUiChannelResponse");

export const OpenWebUiChannelMembersResponseSchema = z
  .strictObject({
    users: z.array(OpenWebUiChannelUserResponseSchema),
    total: z.number().int().nonnegative(),
  })
  .openapi("OpenWebUiChannelMembersResponse");

export const OpenWebUiChannelRequestSchema = z
  .strictObject({
    type: z.string().trim().max(40).optional(),
    name: z.string().trim().max(128).default(""),
    description: z.string().trim().max(5_000).nullable().optional(),
    is_private: z.boolean().nullable().optional(),
    data: jsonObject.nullable().optional(),
    meta: jsonObject.nullable().optional(),
    access_grants: z.array(jsonObject).max(200).optional(),
    group_ids: z.array(identifier).max(200).optional(),
    user_ids: z.array(identifier).max(200).optional(),
  })
  .openapi("OpenWebUiChannelRequest");

export const OpenWebUiUpdateChannelRequestSchema =
  OpenWebUiChannelRequestSchema.omit({ type: true })
    .partial()
    .openapi("OpenWebUiUpdateChannelRequest");

export const OpenWebUiChannelMemberResponseSchema = z
  .strictObject({
    id: identifier,
    channel_id: identifier,
    user_id: identifier,
    role: z.string().nullable(),
    status: z.string().nullable(),
    is_active: z.boolean(),
    is_channel_muted: z.boolean(),
    is_channel_pinned: z.boolean(),
    data: jsonObject.nullable(),
    meta: jsonObject.nullable(),
    invited_at: epoch.nullable(),
    invited_by: identifier.nullable(),
    joined_at: epoch,
    left_at: epoch.nullable(),
    last_read_at: epoch.nullable(),
    created_at: epoch,
    updated_at: epoch,
  })
  .openapi("OpenWebUiChannelMemberResponse");

export const OpenWebUiChannelMessageRequestSchema = z
  .strictObject({
    temp_id: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(1).max(20_000),
    reply_to_id: identifier.optional(),
    parent_id: identifier.optional(),
    data: jsonObject.nullable().optional(),
    meta: jsonObject.nullable().optional(),
  })
  .openapi("OpenWebUiChannelMessageRequest");

export interface OpenWebUiChannelMessageResponse {
  id: string;
  user_id: string;
  channel_id: string;
  reply_to_id: string | null;
  parent_id: string | null;
  is_pinned: boolean;
  pinned_by: string | null;
  pinned_at: number | null;
  content: string;
  data: Record<string, unknown> | null | boolean;
  meta: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  user: OpenWebUiChannelUserResponse | null;
  reply_to_message: OpenWebUiChannelMessageResponse | null;
  latest_reply_at: number | null;
  reply_count: number;
  reactions: unknown[];
}

export const OpenWebUiChannelMessageResponseSchema: z.ZodType<OpenWebUiChannelMessageResponse> =
  z
    .lazy(() =>
      z.strictObject({
        id: identifier,
        user_id: identifier,
        channel_id: identifier,
        reply_to_id: identifier.nullable(),
        parent_id: identifier.nullable(),
        is_pinned: z.boolean(),
        pinned_by: identifier.nullable(),
        pinned_at: epoch.nullable(),
        content: z.string(),
        data: z.union([jsonObject, z.boolean(), z.null()]),
        meta: jsonObject.nullable(),
        created_at: epoch,
        updated_at: epoch,
        user: OpenWebUiChannelUserResponseSchema.nullable(),
        reply_to_message: OpenWebUiChannelMessageResponseSchema.nullable(),
        latest_reply_at: epoch.nullable(),
        reply_count: z.number().int().nonnegative(),
        reactions: z.array(z.unknown()),
      }),
    )
    .openapi("OpenWebUiChannelMessageResponse");

export const OpenWebUiChannelMessagePinRequestSchema = z
  .strictObject({ is_pinned: z.boolean() })
  .openapi("OpenWebUiChannelMessagePinRequest");
export const OpenWebUiChannelMessageReactionRequestSchema = z
  .strictObject({ name: z.string().trim().min(1).max(120) })
  .openapi("OpenWebUiChannelMessageReactionRequest");
export const OpenWebUiChannelMemberActiveRequestSchema = z
  .strictObject({ is_active: z.boolean() })
  .openapi("OpenWebUiChannelMemberActiveRequest");
export const OpenWebUiChannelMembersUpdateRequestSchema = z
  .strictObject({
    user_ids: z.array(identifier).max(200).optional(),
    group_ids: z.array(identifier).max(200).optional(),
  })
  .openapi("OpenWebUiChannelMembersUpdateRequest");

export const OpenWebUiChannelEventSchema = z
  .strictObject({
    id: identifier,
    channel_id: identifier,
    message_id: identifier.nullable(),
    created_at: epoch,
    data: z.strictObject({
      type: z.enum([
        "channel:connected",
        "message",
        "message:reply",
        "message:update",
        "message:delete",
        "message:reaction:add",
        "message:reaction:remove",
        "last_read_at",
      ]),
      data: z.unknown(),
    }),
    user: OpenWebUiChannelUserResponseSchema.nullable(),
    channel: OpenWebUiChannelResponseSchema.nullable(),
  })
  .openapi("OpenWebUiChannelEvent");

export type OpenWebUiChannelUserResponse = z.infer<
  typeof OpenWebUiChannelUserResponseSchema
>;
export type OpenWebUiChannelListItemResponse = z.infer<
  typeof OpenWebUiChannelListItemResponseSchema
>;
export type OpenWebUiChannelResponse = z.infer<
  typeof OpenWebUiChannelResponseSchema
>;
export type OpenWebUiChannelMembersResponse = z.infer<
  typeof OpenWebUiChannelMembersResponseSchema
>;
export type OpenWebUiChannelInput = z.input<
  typeof OpenWebUiChannelRequestSchema
>;
export type OpenWebUiChannelMemberResponse = z.infer<
  typeof OpenWebUiChannelMemberResponseSchema
>;
export type OpenWebUiChannelMessageInput = z.infer<
  typeof OpenWebUiChannelMessageRequestSchema
>;
export type OpenWebUiChannelEvent = z.infer<typeof OpenWebUiChannelEventSchema>;
export type OpenWebUiChannelEventDataType =
  OpenWebUiChannelEvent["data"]["type"];
