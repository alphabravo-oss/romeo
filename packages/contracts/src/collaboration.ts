import { createRoute, z } from "@hono/zod-openapi";

import { ChatSchema } from "./chats";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ResourceGrantSchema,
  ShareResourceSchema,
  ShareTargetSchema,
} from "./collaboration-sharing-schemas";
import {
  CreateFavoriteSchema,
  ResourceFavoriteSchema,
} from "./collaboration-favorite-schemas";
import {
  CreateFolderItemSchema,
  WorkspaceFolderItemSchema,
} from "./collaboration-folder-item-schemas";
import {
  AssignChatTagSchema,
  ChatTagSchema,
} from "./collaboration-chat-tag-schemas";

export {
  ResourceGrantSchema,
  ShareResourceSchema,
  ShareTargetSchema,
} from "./collaboration-sharing-schemas";
export {
  CreateFavoriteSchema,
  ResourceFavoriteSchema,
} from "./collaboration-favorite-schemas";
export {
  AssignChatTagSchema,
  ChatTagSchema,
} from "./collaboration-chat-tag-schemas";
export {
  CreateFolderItemSchema,
  WorkspaceFolderItemSchema,
} from "./collaboration-folder-item-schemas";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const WorkspaceFolderSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    workspaceId: identifier,
    name: z.string().min(1).max(120),
    parentId: identifier.optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    isExpanded: z.boolean().optional(),
    createdBy: identifier,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("WorkspaceFolder");

export const CreateFolderSchema = z
  .strictObject({
    workspaceId: identifier,
    name: z.string().trim().min(1).max(120),
    parentId: z.union([identifier, z.null()]).optional(),
    meta: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    data: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    isExpanded: z.boolean().optional(),
  })
  .openapi("CreateFolderRequest");

export const UpdateFolderSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.union([identifier, z.null()]).optional(),
    meta: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    data: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    isExpanded: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one folder field is required.",
  })
  .openapi("UpdateFolderRequest");

const metadata = {
  tags: ["Collaboration"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;
const shareResponse = dataEnvelope(z.array(ResourceGrantSchema));

export const listShareTargetsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/share-targets",
  operationId: "collaboration.listShareTargets",
  summary: "Search same-organization share targets",
  request: {
    query: z.strictObject({
      query: z.string().max(500).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Share targets",
      dataEnvelope(z.array(ShareTargetSchema)),
    ),
    ...errors,
  },
});

export const listKnowledgeBaseSharesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/shares",
  operationId: "collaboration.listKnowledgeBaseShares",
  summary: "List knowledge-base shares",
  request: { params: z.strictObject({ knowledgeBaseId: identifier }) },
  responses: { 200: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const shareKnowledgeBaseRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/shares",
  operationId: "collaboration.shareKnowledgeBase",
  summary: "Share a knowledge base",
  request: {
    params: z.strictObject({ knowledgeBaseId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: ShareResourceSchema } },
    },
  },
  responses: { 201: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const listChatSharesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/shares",
  operationId: "collaboration.listChatShares",
  summary: "List chat shares",
  request: { params: z.strictObject({ chatId: identifier }) },
  responses: { 200: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const shareChatRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/shares",
  operationId: "collaboration.shareChat",
  summary: "Share a chat",
  request: {
    params: z.strictObject({ chatId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: ShareResourceSchema } },
    },
  },
  responses: { 201: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const revokeChatShareRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/chats/{chatId}/shares/{grantId}",
  operationId: "collaboration.revokeChatShare",
  summary: "Revoke a chat share",
  request: {
    params: z.strictObject({ chatId: identifier, grantId: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Revoked resource grant",
      dataEnvelope(ResourceGrantSchema),
    ),
    ...errors,
  },
});
export const listFileSharesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files/{fileId}/shares",
  operationId: "collaboration.listFileShares",
  summary: "List file shares",
  request: { params: z.strictObject({ fileId: identifier }) },
  responses: { 200: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const shareFileRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/{fileId}/shares",
  operationId: "collaboration.shareFile",
  summary: "Share a file",
  request: {
    params: z.strictObject({ fileId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: ShareResourceSchema } },
    },
  },
  responses: { 201: jsonResponse("Resource grants", shareResponse), ...errors },
});

export const listFavoritesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/favorites",
  operationId: "collaboration.listFavorites",
  summary: "List caller favorites",
  responses: {
    200: jsonResponse(
      "Resource favorites",
      dataEnvelope(z.array(ResourceFavoriteSchema)),
    ),
    ...errors,
  },
});
export const createFavoriteRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/favorites",
  operationId: "collaboration.createFavorite",
  summary: "Favorite a resource",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateFavoriteSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Resource favorite",
      dataEnvelope(ResourceFavoriteSchema),
    ),
    ...errors,
  },
});
export const deleteFavoriteRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/favorites/{favoriteId}",
  operationId: "collaboration.deleteFavorite",
  summary: "Delete a favorite",
  request: { params: z.strictObject({ favoriteId: identifier }) },
  responses: {
    200: jsonResponse(
      "Deleted resource favorite",
      dataEnvelope(ResourceFavoriteSchema),
    ),
    ...errors,
  },
});

export const listFoldersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/folders",
  operationId: "collaboration.listFolders",
  summary: "List workspace folders",
  request: { query: z.strictObject({ workspaceId: identifier }) },
  responses: {
    200: jsonResponse(
      "Workspace folders",
      dataEnvelope(z.array(WorkspaceFolderSchema)),
    ),
    ...errors,
  },
});
export const createFolderRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/folders",
  operationId: "collaboration.createFolder",
  summary: "Create a workspace folder",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateFolderSchema } },
    },
  },
  responses: {
    201: jsonResponse("Workspace folder", dataEnvelope(WorkspaceFolderSchema)),
    ...errors,
  },
});
export const getFolderRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/folders/{folderId}",
  operationId: "collaboration.getFolder",
  summary: "Get a workspace folder",
  request: { params: z.strictObject({ folderId: identifier }) },
  responses: {
    200: jsonResponse("Workspace folder", dataEnvelope(WorkspaceFolderSchema)),
    ...errors,
  },
});
export const updateFolderRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/collaboration/folders/{folderId}",
  operationId: "collaboration.updateFolder",
  summary: "Update a workspace folder",
  request: {
    params: z.strictObject({ folderId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: UpdateFolderSchema } },
    },
  },
  responses: {
    200: jsonResponse("Workspace folder", dataEnvelope(WorkspaceFolderSchema)),
    ...errors,
  },
});
export const deleteFolderRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/folders/{folderId}",
  operationId: "collaboration.deleteFolder",
  summary: "Delete a workspace folder",
  request: { params: z.strictObject({ folderId: identifier }) },
  responses: {
    200: jsonResponse(
      "Deleted workspace folder",
      dataEnvelope(WorkspaceFolderSchema),
    ),
    ...errors,
  },
});
export const listFolderSharesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/folders/{folderId}/shares",
  operationId: "collaboration.listFolderShares",
  summary: "List folder shares",
  request: { params: z.strictObject({ folderId: identifier }) },
  responses: { 200: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const shareFolderRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/folders/{folderId}/shares",
  operationId: "collaboration.shareFolder",
  summary: "Share a folder",
  request: {
    params: z.strictObject({ folderId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: ShareResourceSchema } },
    },
  },
  responses: { 201: jsonResponse("Resource grants", shareResponse), ...errors },
});
export const listFolderItemsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/collaboration/folders/{folderId}/items",
  operationId: "collaboration.listFolderItems",
  summary: "List folder items",
  request: { params: z.strictObject({ folderId: identifier }) },
  responses: {
    200: jsonResponse(
      "Workspace folder items",
      dataEnvelope(z.array(WorkspaceFolderItemSchema)),
    ),
    ...errors,
  },
});
export const addFolderItemRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/folders/{folderId}/items",
  operationId: "collaboration.addFolderItem",
  summary: "Add an item to a folder",
  request: {
    params: z.strictObject({ folderId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: CreateFolderItemSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Workspace folder item",
      dataEnvelope(WorkspaceFolderItemSchema),
    ),
    ...errors,
  },
});
export const deleteFolderItemRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/collaboration/folders/{folderId}/items/{itemId}",
  operationId: "collaboration.deleteFolderItem",
  summary: "Delete a folder item",
  request: {
    params: z.strictObject({ folderId: identifier, itemId: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Deleted workspace folder item",
      dataEnvelope(WorkspaceFolderItemSchema),
    ),
    ...errors,
  },
});

export const listChatTagsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chat-tags",
  operationId: "collaboration.listChatTags",
  summary: "List caller-scoped chat tags",
  responses: {
    200: jsonResponse("Chat tags", dataEnvelope(z.array(ChatTagSchema))),
    ...errors,
  },
});
export const listChatsForTagRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chat-tags/{tagSlug}/chats",
  operationId: "collaboration.listChatsForTag",
  summary: "List chats assigned to a tag",
  request: {
    params: z.strictObject({ tagSlug: identifier }),
    query: z.strictObject({
      archived: z.enum(["active", "archived", "all"]).optional(),
    }),
  },
  responses: {
    200: jsonResponse("Tagged chats", dataEnvelope(z.array(ChatSchema))),
    ...errors,
  },
});
export const listChatTagAssignmentsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/tag-assignments",
  operationId: "collaboration.listChatTagAssignments",
  summary: "List tags assigned to a chat",
  request: { params: z.strictObject({ chatId: identifier }) },
  responses: {
    200: jsonResponse(
      "Assigned chat tags",
      dataEnvelope(z.array(ChatTagSchema)),
    ),
    ...errors,
  },
});
export const assignChatTagRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/tag-assignments",
  operationId: "collaboration.assignChatTag",
  summary: "Assign a tag to a chat",
  request: {
    params: z.strictObject({ chatId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: AssignChatTagSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Assigned chat tags",
      dataEnvelope(z.array(ChatTagSchema)),
    ),
    ...errors,
  },
});
export const removeChatTagRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/chats/{chatId}/tag-assignments/{tagSlug}",
  operationId: "collaboration.removeChatTag",
  summary: "Remove a tag from a chat",
  request: {
    params: z.strictObject({ chatId: identifier, tagSlug: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Assigned chat tags",
      dataEnvelope(z.array(ChatTagSchema)),
    ),
    ...errors,
  },
});
