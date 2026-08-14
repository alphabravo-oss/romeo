import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  CreateFolderItemSchema,
  WorkspaceFolderItemSchema,
} from "./collaboration-folder-item-schemas";
import {
  ResourceGrantSchema,
  ShareResourceSchema,
} from "./collaboration-sharing-schemas";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const metadata = {
  tags: ["Collaboration"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;
const shareResponse = dataEnvelope(z.array(ResourceGrantSchema));

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

export const ListFolderItemsBatchSchema = z
  .strictObject({
    workspaceId: identifier,
    folderIds: z.array(identifier).min(1).max(50),
    limitPerFolder: z.number().int().min(1).max(200).default(100),
  })
  .refine((value) => new Set(value.folderIds).size === value.folderIds.length, {
    message: "Folder IDs must be unique.",
    path: ["folderIds"],
  })
  .openapi("ListFolderItemsBatchRequest");

export const WorkspaceFolderItemsBatchGroupSchema = z
  .strictObject({
    folderId: identifier,
    hasMore: z.boolean(),
    items: z.array(WorkspaceFolderItemSchema).max(200),
  })
  .openapi("WorkspaceFolderItemsBatchGroup");

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

export const listFolderItemsBatchRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/collaboration/folder-items/batch",
  operationId: "collaboration.listFolderItemsBatch",
  summary: "List authorized items for a bounded folder batch",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ListFolderItemsBatchSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Authorized workspace folder item groups",
      dataEnvelope(z.array(WorkspaceFolderItemsBatchGroupSchema).max(50)),
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
