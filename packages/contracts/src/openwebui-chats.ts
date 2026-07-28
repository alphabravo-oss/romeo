import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  OpenWebUiChatResponseSchema,
  OpenWebUiChatTagLookupSchema,
  OpenWebUiChatTitleIdResponseSchema,
  OpenWebUiCreateChatSchema,
  OpenWebUiCreateFolderSchema,
  OpenWebUiFolderListItemResponseSchema,
  OpenWebUiFolderResponseSchema,
  OpenWebUiTagResponseSchema,
  OpenWebUiUpdateChatFolderSchema,
  OpenWebUiUpdateFolderExpandedSchema,
  OpenWebUiUpdateFolderParentSchema,
  OpenWebUiUpdateFolderSchema,
} from "./openwebui-chat-schemas";

const tags = ["OpenWebUI compatibility"];
const identifier = z.string().trim().min(1).max(300);
const page = z.coerce.number().int().min(1).max(10_000).optional();
const chatPath = z.strictObject({ chatId: identifier });
const folderPath = z.strictObject({ folderId: identifier });
const chatListQuery = z.strictObject({
  page,
  include_pinned: z.enum(["true", "false"]).optional(),
  include_folders: z.enum(["true", "false"]).optional(),
});
const pageQuery = z.strictObject({ page });
const searchQuery = z.strictObject({ text: z.string(), page });
const deleteFolderQuery = z.strictObject({
  delete_contents: z.enum(["true", "false"]).optional(),
});
const chatSummaries = jsonResponse(
  "OpenWebUI-compatible chat summaries",
  z.array(OpenWebUiChatTitleIdResponseSchema),
);
const chats = jsonResponse(
  "OpenWebUI-compatible chats",
  z.array(OpenWebUiChatResponseSchema),
);
const chat = jsonResponse(
  "OpenWebUI-compatible chat",
  OpenWebUiChatResponseSchema,
);
const tagList = jsonResponse(
  "OpenWebUI-compatible chat tags",
  z.array(OpenWebUiTagResponseSchema),
);
const folder = jsonResponse(
  "OpenWebUI-compatible folder",
  OpenWebUiFolderResponseSchema,
);
const requestBody = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});
const base = {
  tags,
  security: authenticationSecurity,
} as const;

export const listOpenWebUiChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/",
  operationId: "openWebUi.listChats",
  summary: "List OpenWebUI-compatible chat summaries",
  request: { query: chatListQuery },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const listOpenWebUiChatsAliasRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/list",
  operationId: "openWebUi.listChatsAlias",
  summary: "List OpenWebUI-compatible chat summaries alias",
  request: { query: chatListQuery },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const createOpenWebUiChatRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/chats/new",
  operationId: "openWebUi.createChat",
  summary: "Create an OpenWebUI-compatible chat",
  request: { body: requestBody(OpenWebUiCreateChatSchema) },
  responses: { 200: chat, ...standardErrorResponses },
});
export const listOpenWebUiPinnedChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/pinned",
  operationId: "openWebUi.listPinnedChats",
  summary: "List OpenWebUI-compatible pinned chat summaries",
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const getOpenWebUiChatPinnedStatusRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/{chatId}/pinned",
  operationId: "openWebUi.getChatPinnedStatus",
  summary: "Get OpenWebUI-compatible chat pinned status",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible pinned status",
      z.boolean().nullable(),
    ),
    ...standardErrorResponses,
  },
});
export const toggleOpenWebUiChatPinnedRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/chats/{chatId}/pin",
  operationId: "openWebUi.toggleChatPinned",
  summary: "Toggle OpenWebUI-compatible chat pin state",
  request: { params: chatPath },
  responses: { 200: chat, ...standardErrorResponses },
});
export const searchOpenWebUiChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/search",
  operationId: "openWebUi.searchChats",
  summary: "Search OpenWebUI-compatible chat summaries",
  request: { query: searchQuery },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const listOpenWebUiArchivedChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/archived",
  operationId: "openWebUi.listArchivedChats",
  summary: "List OpenWebUI-compatible archived chat summaries",
  request: { query: pageQuery },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const listAllOpenWebUiArchivedChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/all/archived",
  operationId: "openWebUi.listAllArchivedChats",
  summary: "List all OpenWebUI-compatible archived chats",
  responses: { 200: chats, ...standardErrorResponses },
});
export const listOpenWebUiTagsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/all/tags",
  operationId: "openWebUi.listTags",
  summary: "List OpenWebUI-compatible chat tags",
  responses: { 200: tagList, ...standardErrorResponses },
});
export const listOpenWebUiChatsByTagRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/chats/tags",
  operationId: "openWebUi.listChatsByTag",
  summary: "List OpenWebUI-compatible chats by tag",
  request: { body: requestBody(OpenWebUiChatTagLookupSchema) },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const listOpenWebUiChatTagsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/{chatId}/tags",
  operationId: "openWebUi.listChatTags",
  summary: "List OpenWebUI-compatible tags for a chat",
  request: { params: chatPath },
  responses: { 200: tagList, ...standardErrorResponses },
});
export const addOpenWebUiChatTagRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/chats/{chatId}/tags",
  operationId: "openWebUi.addChatTag",
  summary: "Assign an OpenWebUI-compatible tag to a chat",
  request: {
    params: chatPath,
    body: requestBody(OpenWebUiChatTagLookupSchema),
  },
  responses: { 200: tagList, ...standardErrorResponses },
});
export const deleteOpenWebUiChatTagRoute = createRoute({
  ...base,
  method: "delete",
  path: "/api/v1/chats/{chatId}/tags",
  operationId: "openWebUi.deleteChatTag",
  summary: "Remove an OpenWebUI-compatible tag from a chat",
  request: {
    params: chatPath,
    body: requestBody(OpenWebUiChatTagLookupSchema),
  },
  responses: { 200: tagList, ...standardErrorResponses },
});
export const listOpenWebUiFolderChatsRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/folder/{folderId}",
  operationId: "openWebUi.listFolderChats",
  summary: "List OpenWebUI-compatible chats in a folder",
  request: { params: folderPath },
  responses: { 200: chats, ...standardErrorResponses },
});
export const listOpenWebUiFolderChatSummariesRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/chats/folder/{folderId}/list",
  operationId: "openWebUi.listFolderChatSummaries",
  summary: "List OpenWebUI-compatible chat summaries in a folder",
  request: { params: folderPath, query: pageQuery },
  responses: { 200: chatSummaries, ...standardErrorResponses },
});
export const updateOpenWebUiChatFolderRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/chats/{chatId}/folder",
  operationId: "openWebUi.updateChatFolder",
  summary: "Move an OpenWebUI-compatible chat to a folder",
  request: {
    params: chatPath,
    body: requestBody(OpenWebUiUpdateChatFolderSchema),
  },
  responses: { 200: chat, ...standardErrorResponses },
});
export const listOpenWebUiFoldersRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/folders/",
  operationId: "openWebUi.listFolders",
  summary: "List OpenWebUI-compatible folders",
  responses: {
    200: jsonResponse(
      "OpenWebUI-compatible folders",
      z.array(OpenWebUiFolderListItemResponseSchema),
    ),
    ...standardErrorResponses,
  },
});
export const createOpenWebUiFolderRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/folders/",
  operationId: "openWebUi.createFolder",
  summary: "Create an OpenWebUI-compatible folder",
  request: { body: requestBody(OpenWebUiCreateFolderSchema) },
  responses: { 200: folder, ...standardErrorResponses },
});
export const getOpenWebUiFolderRoute = createRoute({
  ...base,
  method: "get",
  path: "/api/v1/folders/{folderId}",
  operationId: "openWebUi.getFolder",
  summary: "Get an OpenWebUI-compatible folder",
  request: { params: folderPath },
  responses: { 200: folder, ...standardErrorResponses },
});
export const updateOpenWebUiFolderRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/folders/{folderId}/update",
  operationId: "openWebUi.updateFolder",
  summary: "Update an OpenWebUI-compatible folder",
  request: {
    params: folderPath,
    body: requestBody(OpenWebUiUpdateFolderSchema),
  },
  responses: { 200: folder, ...standardErrorResponses },
});
export const updateOpenWebUiFolderExpandedRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/folders/{folderId}/update/expanded",
  operationId: "openWebUi.updateFolderExpanded",
  summary: "Update an OpenWebUI-compatible folder expanded state",
  request: {
    params: folderPath,
    body: requestBody(OpenWebUiUpdateFolderExpandedSchema),
  },
  responses: { 200: folder, ...standardErrorResponses },
});
export const updateOpenWebUiFolderParentRoute = createRoute({
  ...base,
  method: "post",
  path: "/api/v1/folders/{folderId}/update/parent",
  operationId: "openWebUi.updateFolderParent",
  summary: "Update an OpenWebUI-compatible folder parent",
  request: {
    params: folderPath,
    body: requestBody(OpenWebUiUpdateFolderParentSchema),
  },
  responses: { 200: folder, ...standardErrorResponses },
});
export const deleteOpenWebUiFolderRoute = createRoute({
  ...base,
  method: "delete",
  path: "/api/v1/folders/{folderId}",
  operationId: "openWebUi.deleteFolder",
  summary: "Delete an OpenWebUI-compatible folder",
  request: { params: folderPath, query: deleteFolderQuery },
  responses: { 200: folder, ...standardErrorResponses },
});

export const openWebUiChatRoutes = [
  listOpenWebUiChatsRoute,
  listOpenWebUiChatsAliasRoute,
  createOpenWebUiChatRoute,
  listOpenWebUiPinnedChatsRoute,
  getOpenWebUiChatPinnedStatusRoute,
  toggleOpenWebUiChatPinnedRoute,
  searchOpenWebUiChatsRoute,
  listOpenWebUiArchivedChatsRoute,
  listAllOpenWebUiArchivedChatsRoute,
  listOpenWebUiTagsRoute,
  listOpenWebUiChatsByTagRoute,
  listOpenWebUiChatTagsRoute,
  addOpenWebUiChatTagRoute,
  deleteOpenWebUiChatTagRoute,
  listOpenWebUiFolderChatsRoute,
  listOpenWebUiFolderChatSummariesRoute,
  updateOpenWebUiChatFolderRoute,
  listOpenWebUiFoldersRoute,
  createOpenWebUiFolderRoute,
  getOpenWebUiFolderRoute,
  updateOpenWebUiFolderRoute,
  updateOpenWebUiFolderExpandedRoute,
  updateOpenWebUiFolderParentRoute,
  deleteOpenWebUiFolderRoute,
] as const;
