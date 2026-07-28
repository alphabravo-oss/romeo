import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const jsonObject = z.record(z.string(), z.unknown());

export const OpenWebUiChatTitleIdResponseSchema = z
  .strictObject({
    id: identifier,
    title: z.string(),
    updated_at: z.number().int().nonnegative(),
    created_at: z.number().int().nonnegative(),
    last_read_at: z.null(),
  })
  .openapi("OpenWebUiChatTitleIdResponse");

export const OpenWebUiChatResponseSchema =
  OpenWebUiChatTitleIdResponseSchema.extend({
    user_id: identifier,
    chat: jsonObject,
    share_id: z.null(),
    archived: z.boolean(),
    pinned: z.boolean(),
    meta: jsonObject,
    folder_id: identifier.nullable(),
    tasks: z.null(),
    summary: z.null(),
  }).openapi("OpenWebUiChatResponse");

export const OpenWebUiCreateChatSchema = z
  .strictObject({
    chat: jsonObject,
    folder_id: identifier.nullable().optional(),
  })
  .openapi("OpenWebUiCreateChatRequest");

export const OpenWebUiFolderListItemResponseSchema = z
  .strictObject({
    id: identifier,
    name: z.string(),
    meta: jsonObject.nullable(),
    parent_id: identifier.nullable(),
    is_expanded: z.boolean(),
    created_at: z.number().int().nonnegative(),
    updated_at: z.number().int().nonnegative(),
  })
  .openapi("OpenWebUiFolderListItemResponse");

export const OpenWebUiFolderResponseSchema =
  OpenWebUiFolderListItemResponseSchema.extend({
    user_id: identifier,
    items: z.null(),
    data: jsonObject.nullable(),
  }).openapi("OpenWebUiFolderResponse");

export const OpenWebUiCreateFolderSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160),
    data: jsonObject.nullable().optional(),
    meta: jsonObject.nullable().optional(),
    parent_id: identifier.nullable().optional(),
  })
  .openapi("OpenWebUiCreateFolderRequest");

export const OpenWebUiUpdateFolderSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    data: jsonObject.nullable().optional(),
    meta: jsonObject.nullable().optional(),
    parent_id: identifier.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one folder field is required.",
  })
  .openapi("OpenWebUiUpdateFolderRequest");

export const OpenWebUiUpdateFolderExpandedSchema = z
  .strictObject({ is_expanded: z.boolean() })
  .openapi("OpenWebUiUpdateFolderExpandedRequest");

export const OpenWebUiUpdateFolderParentSchema = z
  .strictObject({ parent_id: identifier.nullable().optional() })
  .openapi("OpenWebUiUpdateFolderParentRequest");

export const OpenWebUiUpdateChatFolderSchema = z
  .strictObject({ folder_id: identifier.nullable().optional() })
  .openapi("OpenWebUiUpdateChatFolderRequest");

export const OpenWebUiTagResponseSchema = z
  .strictObject({
    id: identifier,
    name: z.string(),
    user_id: identifier,
    meta: jsonObject.nullable(),
  })
  .openapi("OpenWebUiTagResponse");

export const OpenWebUiChatTagLookupSchema = z
  .strictObject({ name: z.string().trim().min(1).max(160) })
  .openapi("OpenWebUiChatTagLookupRequest");

export type OpenWebUiChatTitleIdResponse = z.infer<
  typeof OpenWebUiChatTitleIdResponseSchema
>;
export type OpenWebUiChatResponse = z.infer<typeof OpenWebUiChatResponseSchema>;
export type OpenWebUiCreateChatInput = z.infer<
  typeof OpenWebUiCreateChatSchema
>;
export type OpenWebUiFolderListItemResponse = z.infer<
  typeof OpenWebUiFolderListItemResponseSchema
>;
export type OpenWebUiFolderResponse = z.infer<
  typeof OpenWebUiFolderResponseSchema
>;
export type OpenWebUiCreateFolderInput = z.infer<
  typeof OpenWebUiCreateFolderSchema
>;
export type OpenWebUiUpdateFolderInput = z.infer<
  typeof OpenWebUiUpdateFolderSchema
>;
export type OpenWebUiUpdateChatFolderInput = z.infer<
  typeof OpenWebUiUpdateChatFolderSchema
>;
export type OpenWebUiTagResponse = z.infer<typeof OpenWebUiTagResponseSchema>;
