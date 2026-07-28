import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const folderItemResourceType = z.enum(["agent", "chat", "knowledge_base"]);

export const WorkspaceFolderItemSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    workspaceId: identifier,
    folderId: identifier,
    resourceType: folderItemResourceType,
    resourceId: identifier,
    createdAt: z.iso.datetime(),
  })
  .openapi("WorkspaceFolderItem");

export const CreateFolderItemSchema = z
  .strictObject({
    resourceType: folderItemResourceType,
    resourceId: identifier,
  })
  .openapi("CreateFolderItemRequest");
