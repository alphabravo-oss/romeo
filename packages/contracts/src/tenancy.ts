import { createRoute, z } from "@hono/zod-openapi";

import { OrganizationSchema, WorkspaceSchema } from "./identity";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const workspacePath = z.strictObject({ workspaceId: identifier });

export const CreateWorkspaceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(1).max(80).optional(),
  })
  .openapi("CreateWorkspaceRequest");

export const WorkspaceExportDocumentSchema = z
  .strictObject({
    schema: z.literal("romeo.workspace-export.v1"),
    orgId: identifier,
    workspace: WorkspaceSchema,
    counts: z.strictObject({
      agents: z.number().int().nonnegative(),
      chats: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative(),
      knowledgeBases: z.number().int().nonnegative(),
      dataConnectors: z.number().int().nonnegative(),
      workflows: z.number().int().nonnegative(),
    }),
    resources: z.strictObject({
      agents: z.array(
        z.strictObject({
          id: identifier,
          publishedVersionId: identifier.optional(),
          updatedAt: timestamp,
        }),
      ),
      chats: z.array(
        z.strictObject({
          id: identifier,
          archivedAt: timestamp.optional(),
          updatedAt: timestamp,
        }),
      ),
      knowledgeBases: z.array(
        z.strictObject({
          id: identifier,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      ),
      dataConnectors: z.array(
        z.strictObject({
          id: identifier,
          knowledgeBaseId: identifier,
          status: z.string(),
          type: z.string(),
        }),
      ),
      workflows: z.array(
        z.strictObject({
          enabled: z.boolean(),
          id: identifier,
          stepCount: z.number().int().nonnegative(),
          updatedAt: timestamp,
        }),
      ),
    }),
    exportedAt: timestamp,
  })
  .openapi("WorkspaceExportDocument");

const metadata = { tags: ["Tenancy"], security: authenticationSecurity };
const errors = standardErrorResponses;

export const listOrganizationsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/organizations",
  operationId: "tenancy.listOrganizations",
  summary: "List visible organizations",
  responses: {
    200: jsonResponse(
      "Organizations",
      dataEnvelope(z.array(OrganizationSchema)),
    ),
    ...errors,
  },
});

export const listWorkspacesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/workspaces",
  operationId: "tenancy.listWorkspaces",
  summary: "List visible workspaces",
  responses: {
    200: jsonResponse("Workspaces", dataEnvelope(z.array(WorkspaceSchema))),
    ...errors,
  },
});

export const createWorkspaceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/workspaces",
  operationId: "tenancy.createWorkspace",
  summary: "Create a workspace",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateWorkspaceSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created workspace", dataEnvelope(WorkspaceSchema)),
    ...errors,
  },
});

export const archiveWorkspaceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/workspaces/{workspaceId}/archive",
  operationId: "tenancy.archiveWorkspace",
  summary: "Archive a workspace",
  request: { params: workspacePath },
  responses: {
    200: jsonResponse("Archived workspace", dataEnvelope(WorkspaceSchema)),
    ...errors,
  },
});

export const exportWorkspaceRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/workspaces/{workspaceId}/export",
  operationId: "tenancy.exportWorkspace",
  summary: "Export a sanitized workspace inventory",
  request: { params: workspacePath },
  responses: {
    200: jsonResponse(
      "Workspace export",
      dataEnvelope(WorkspaceExportDocumentSchema),
    ),
    ...errors,
  },
});

export const tenancyRoutes = [
  listOrganizationsRoute,
  listWorkspacesRoute,
  createWorkspaceRoute,
  archiveWorkspaceRoute,
  exportWorkspaceRoute,
] as const;
