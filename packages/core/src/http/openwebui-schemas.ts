import { z } from "@hono/zod-openapi";

export const openWebUiCreateChatSchema = z.object({
  chat: z.record(z.string(), z.unknown()),
  folder_id: z.string().min(1).nullable().optional(),
});

export const openWebUiCreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(160),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  parent_id: z.string().min(1).nullable().optional(),
});

export const openWebUiUpdateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    meta: z.record(z.string(), z.unknown()).nullable().optional(),
    parent_id: z.string().min(1).nullable().optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one folder field is required.",
  );

export const openWebUiUpdateFolderExpandedSchema = z.object({
  is_expanded: z.boolean(),
});

export const openWebUiUpdateFolderParentSchema = z.object({
  parent_id: z.string().min(1).nullable().optional(),
});

export const openWebUiUpdateChatFolderSchema = z.object({
  folder_id: z.string().min(1).nullable().optional(),
});

export const openWebUiChatTagLookupSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

export const openWebUiChannelSchema = z.object({
  type: z.string().trim().max(40).optional(),
  name: z.string().trim().max(128).default(""),
  description: z.string().trim().max(5000).nullable().optional(),
  is_private: z.boolean().nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  access_grants: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  group_ids: z.array(z.string().min(1)).max(200).optional(),
  user_ids: z.array(z.string().min(1)).max(200).optional(),
});

export const openWebUiUpdateChannelSchema = z.object({
  name: z.string().trim().max(128).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  is_private: z.boolean().nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  access_grants: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  group_ids: z.array(z.string().min(1)).max(200).optional(),
  user_ids: z.array(z.string().min(1)).max(200).optional(),
});

export const openWebUiUpdateChannelMemberActiveSchema = z.object({
  is_active: z.boolean(),
});

export const openWebUiUpdateChannelMembersSchema = z.object({
  user_ids: z.array(z.string().min(1)).max(200).optional(),
  group_ids: z.array(z.string().min(1)).max(200).optional(),
});

export const openWebUiChannelMessagesQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const openWebUiChannelPinnedMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const openWebUiChannelMessageSchema = z.object({
  temp_id: z.string().trim().min(1).max(200).optional(),
  content: z.string().min(1).max(20_000),
  reply_to_id: z.string().trim().min(1).max(200).optional(),
  parent_id: z.string().trim().min(1).max(200).optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const openWebUiChannelMessagePinSchema = z.object({
  is_pinned: z.boolean(),
});

export const openWebUiChannelMessageReactionSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
