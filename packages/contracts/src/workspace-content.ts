import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const WorkspaceContentItemSchema = z
  .strictObject({
    id: identifier,
    workspaceId: identifier,
    kind: z.enum(["memory", "note"]),
    scope: z.enum(["personal", "workspace"]),
    title: z.string().min(1).max(160),
    body: z.string().max(250_000),
    enabled: z.boolean(),
    pinned: z.boolean(),
    ownerId: identifier,
    expiresAt: timestamp.optional(),
    expired: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("WorkspaceContentItem");

export const CreateWorkspaceContentSchema = z
  .strictObject({
    workspaceId: identifier,
    scope: z.enum(["personal", "workspace"]),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(250_000),
    enabled: z.boolean().optional(),
    pinned: z.boolean().optional(),
    expiresAt: timestamp.optional(),
  })
  .openapi("CreateWorkspaceContentRequest");

export const UpdateWorkspaceContentSchema = z
  .strictObject({
    scope: z.enum(["personal", "workspace"]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(250_000).optional(),
    enabled: z.boolean().optional(),
    pinned: z.boolean().optional(),
    expiresAt: z.union([timestamp, z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workspace-content field is required.",
  })
  .openapi("UpdateWorkspaceContentRequest");

const catalogQuery = z.strictObject({
  workspaceId: identifier,
  q: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
const contentPath = z.strictObject({ contentId: identifier });
const itemResponse = dataEnvelope(WorkspaceContentItemSchema);
const listResponse = dataEnvelope(z.array(WorkspaceContentItemSchema)).extend({
  meta: z
    .strictObject({
      hasMore: z.boolean(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .optional(),
});
const metadata = {
  tags: ["Workspace content"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;
export const listMemoriesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/memories",
  operationId: "workspaceContent.listMemories",
  summary: "List explicit retained memories",
  request: { query: catalogQuery },
  responses: { 200: jsonResponse("Memories", listResponse), ...errors },
});
export const createMemoryRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/memories",
  operationId: "workspaceContent.createMemory",
  summary: "Create an explicit retained memory",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateWorkspaceContentSchema } },
    },
  },
  responses: { 201: jsonResponse("Created memory", itemResponse), ...errors },
});
export const updateMemoryRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/memories/{contentId}",
  operationId: "workspaceContent.updateMemory",
  summary: "Update an explicit retained memory",
  request: {
    params: contentPath,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateWorkspaceContentSchema } },
    },
  },
  responses: { 200: jsonResponse("Updated memory", itemResponse), ...errors },
});
export const deleteMemoryRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/memories/{contentId}",
  operationId: "workspaceContent.deleteMemory",
  summary: "Delete an explicit retained memory",
  request: { params: contentPath },
  responses: { 200: jsonResponse("Deleted memory", itemResponse), ...errors },
});
export const listNotesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/notes",
  operationId: "workspaceContent.listNotes",
  summary: "List reusable notes",
  request: { query: catalogQuery },
  responses: { 200: jsonResponse("Notes", listResponse), ...errors },
});
export const createNoteRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/notes",
  operationId: "workspaceContent.createNote",
  summary: "Create a reusable note",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateWorkspaceContentSchema } },
    },
  },
  responses: { 201: jsonResponse("Created note", itemResponse), ...errors },
});
export const updateNoteRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/notes/{contentId}",
  operationId: "workspaceContent.updateNote",
  summary: "Update a reusable note",
  request: {
    params: contentPath,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateWorkspaceContentSchema } },
    },
  },
  responses: { 200: jsonResponse("Updated note", itemResponse), ...errors },
});
export const deleteNoteRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/notes/{contentId}",
  operationId: "workspaceContent.deleteNote",
  summary: "Delete a reusable note",
  request: { params: contentPath },
  responses: { 200: jsonResponse("Deleted note", itemResponse), ...errors },
});

export const workspaceContentRoutes = [
  listMemoriesRoute,
  createMemoryRoute,
  updateMemoryRoute,
  deleteMemoryRoute,
  listNotesRoute,
  createNoteRoute,
  updateNoteRoute,
  deleteNoteRoute,
] as const;
