import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { deleteTableExportRoute } from "./table-export-delete";

const identifier = z.string().trim().min(1).max(300);
const metadata = { security: authenticationSecurity };

export const ServerTableSavedViewSchema = z
  .strictObject({
    id: identifier,
    resource: identifier,
    parentId: identifier.optional(),
    name: z.string().trim().min(1).max(80),
    source: z.enum(["server", "local_fallback"]),
    schemaVersion: z.number().int().positive(),
    visibility: z.enum(["private", "workspace"]),
    isDefault: z.boolean(),
    canEdit: z.boolean(),
    version: z.number().int().positive(),
    query: z.strictObject({
      sort: z.array(
        z.strictObject({
          field: identifier,
          direction: z.enum(["asc", "desc"]),
        }),
      ),
      filters: z.array(
        z.strictObject({
          field: identifier,
          operator: identifier,
          value: z.unknown().optional(),
        }),
      ),
      search: z.string().trim().min(1).max(300).optional(),
      pageSize: z.number().int().min(1).max(100),
    }),
    presentation: z.strictObject({
      columnVisibility: z.record(z.string(), z.boolean()),
      density: z.enum(["comfortable", "compact"]),
    }),
  })
  .openapi("ServerTableSavedView");

export const listTableViewsRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-views/list",
  operationId: "tableViews.list",
  summary: "List server saved views with optional local-preference fallback",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            resource: identifier,
            parentId: identifier.optional(),
            localViews: z
              .array(
                z.strictObject({
                  name: z.string().trim().min(1).max(80),
                  globalFilter: z.string().max(300).optional(),
                  pageSize: z.number().int().optional(),
                  density: z.enum(["comfortable", "compact"]).optional(),
                  columnVisibility: z
                    .record(z.string(), z.boolean())
                    .optional(),
                  sorting: z
                    .array(
                      z.strictObject({
                        id: identifier,
                        desc: z.boolean(),
                      }),
                    )
                    .optional(),
                  filters: z
                    .array(
                      z.strictObject({
                        field: identifier,
                        operator: identifier,
                        value: z.unknown().optional(),
                      }),
                    )
                    .max(20)
                    .optional(),
                }),
              )
              .max(25)
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Saved views",
      dataEnvelope(z.array(ServerTableSavedViewSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const replaceTableViewRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "put",
  path: "/api/v1/admin/table-views",
  operationId: "tableViews.replace",
  summary: "Persist a per-user workspace saved view",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            resource: identifier,
            parentId: identifier.optional(),
            name: z.string().trim().min(1).max(80),
            viewId: identifier.optional(),
            expectedVersion: z.number().int().positive().optional(),
            visibility: z.enum(["private", "workspace"]).optional(),
            isDefault: z.boolean().optional(),
            globalFilter: z.string().max(300).optional(),
            pageSize: z.number().int().optional(),
            density: z.enum(["comfortable", "compact"]).optional(),
            columnVisibility: z.record(z.string(), z.boolean()).optional(),
            sorting: z
              .array(z.strictObject({ id: identifier, desc: z.boolean() }))
              .optional(),
            filters: z
              .array(
                z.strictObject({
                  field: identifier,
                  operator: identifier,
                  value: z.unknown().optional(),
                }),
              )
              .max(20)
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Saved view", dataEnvelope(ServerTableSavedViewSchema)),
    ...standardErrorResponses,
  },
});

const savedViewMutationBody = z.strictObject({
  workspaceId: identifier,
  resource: identifier,
  parentId: identifier.optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestToken: identifier.optional(),
});

export const deleteTableViewRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "delete",
  path: "/api/v1/admin/table-views/{viewId}",
  operationId: "tableViews.delete",
  summary: "Delete an owned server saved view",
  request: {
    params: z.strictObject({ viewId: identifier }),
    body: {
      required: true,
      content: { "application/json": { schema: savedViewMutationBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Deleted saved view",
      dataEnvelope(
        z.strictObject({
          deleted: z.boolean(),
          undoToken: identifier.optional(),
          undoExpiresAt: z.iso.datetime().optional(),
          version: z.number().int().positive().optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const restoreTableViewRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-views/{viewId}/restore",
  operationId: "tableViews.restore",
  summary: "Restore a recently deleted owned saved view",
  request: {
    params: z.strictObject({ viewId: identifier }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: savedViewMutationBody.extend({ undoToken: identifier }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Restored saved view",
      dataEnvelope(ServerTableSavedViewSchema),
    ),
    ...standardErrorResponses,
  },
});

export const setDefaultTableViewRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-views/{viewId}/default",
  operationId: "tableViews.setDefault",
  summary: "Set or clear the owned default saved view",
  request: {
    params: z.strictObject({ viewId: identifier }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: savedViewMutationBody.extend({ isDefault: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Saved view", dataEnvelope(ServerTableSavedViewSchema)),
    ...standardErrorResponses,
  },
});

export const shareTableViewRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-views/{viewId}/share",
  operationId: "tableViews.share",
  summary: "Change workspace sharing for an owned saved view",
  request: {
    params: z.strictObject({ viewId: identifier }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: savedViewMutationBody.extend({
            visibility: z.enum(["private", "workspace"]),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Saved view", dataEnvelope(ServerTableSavedViewSchema)),
    ...standardErrorResponses,
  },
});

export const TableExportJobSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z.enum(["table_export_must_be_async"]).optional(),
    jobId: identifier.optional(),
    state: z
      .enum(["queued", "running", "artifact_ready", "failed", "expired"])
      .optional(),
    percent: z.number().int().min(0).max(100).optional(),
    processedRows: z.number().int().nonnegative().optional(),
    attemptCount: z.number().int().nonnegative().optional(),
    errorCode: identifier.optional(),
    artifactId: identifier.optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .openapi("TableExportJob");

export const createTableExportRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-exports",
  operationId: "tableExports.create",
  summary: "Queue an async table export from a frozen query snapshot",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            parentId: identifier.optional(),
            resource: identifier,
            mode: z
              .enum(["browser_csv", "async_artifact"])
              .default("async_artifact"),
            estimatedRows: z.number().int().min(0).max(10_000_000),
            search: z.string().trim().min(1).max(300).optional(),
            sort: z
              .array(
                z.strictObject({
                  field: identifier,
                  direction: z.enum(["asc", "desc"]),
                }),
              )
              .max(3)
              .default([]),
            filters: z
              .array(
                z.strictObject({
                  field: identifier,
                  operator: identifier,
                  value: z.unknown().optional(),
                }),
              )
              .max(20)
              .default([]),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonResponse(
      "Table export job accepted",
      dataEnvelope(TableExportJobSchema),
    ),
    200: jsonResponse("Table export job", dataEnvelope(TableExportJobSchema)),
    ...standardErrorResponses,
  },
});

export const downloadTableExportArtifactRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "get",
  path: "/api/v1/admin/table-exports/{jobId}/artifact",
  operationId: "tableExports.downloadArtifact",
  summary: "Download an authorized, unexpired table-export artifact",
  request: { params: z.strictObject({ jobId: identifier }) },
  responses: {
    200: {
      description: "CSV export artifact",
      content: { "text/csv": { schema: z.string() } },
    },
    ...standardErrorResponses,
  },
});

export const runTableExportRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-exports/{jobId}/run",
  operationId: "tableExports.run",
  summary: "Run one table-export worker tick to an expiring artifact",
  request: { params: z.strictObject({ jobId: identifier }) },
  responses: {
    200: jsonResponse("Table export job", dataEnvelope(TableExportJobSchema)),
    ...standardErrorResponses,
  },
});

export const getTableExportRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "get",
  path: "/api/v1/admin/table-exports/{jobId}",
  operationId: "tableExports.get",
  summary: "Read a table export job and expire stale artifacts",
  request: { params: z.strictObject({ jobId: identifier }) },
  responses: {
    200: jsonResponse("Table export job", dataEnvelope(TableExportJobSchema)),
    ...standardErrorResponses,
  },
});

export const InventoriedTableRowSchema = z
  .object({ id: identifier })
  .catchall(z.unknown())
  .openapi("InventoriedTableRow");

export const InventoriedTablePageSchema = z
  .strictObject({
    items: z.array(InventoriedTableRowSchema),
    page: z.strictObject({
      nextCursor: z.string().min(1).max(2_000).nullable(),
      previousCursor: z.string().min(1).max(2_000).nullable(),
      limit: z.number().int().positive(),
      estimatedTotal: z.number().int().nonnegative(),
    }),
    applied: z.strictObject({
      sort: z.array(
        z.strictObject({
          field: identifier,
          direction: z.enum(["asc", "desc"]),
        }),
      ),
      filters: z.array(
        z.strictObject({
          field: identifier,
          operator: identifier,
          value: z.unknown().optional(),
        }),
      ),
    }),
    resource: identifier,
    summary: z.record(z.string(), z.number().int().nonnegative()).optional(),
  })
  .openapi("InventoriedTablePage");

export const queryTablePagesRoute = createRoute({
  ...metadata,
  tags: ["Administration"],
  method: "post",
  path: "/api/v1/admin/table-pages",
  operationId: "tablePages.query",
  summary: "Page an inventoried admin dataset with a signed cursor",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            resource: identifier,
            parentId: identifier.optional(),
            workspaceId: identifier.optional(),
            cursor: z.string().min(1).max(2_000).optional(),
            limit: z.number().int().min(1).max(100).default(25),
            search: z.string().trim().min(1).max(200).optional(),
            sort: z
              .array(
                z.strictObject({
                  field: identifier,
                  direction: z.enum(["asc", "desc"]),
                }),
              )
              .max(3)
              .default([]),
            filters: z
              .array(
                z.strictObject({
                  field: identifier,
                  operator: identifier,
                  value: z.unknown().optional(),
                }),
              )
              .max(20)
              .default([]),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Inventoried table page",
      dataEnvelope(InventoriedTablePageSchema),
    ),
    ...standardErrorResponses,
  },
});

export const tableSurfaceRoutes = [
  listTableViewsRoute,
  replaceTableViewRoute,
  deleteTableViewRoute,
  restoreTableViewRoute,
  setDefaultTableViewRoute,
  shareTableViewRoute,
  createTableExportRoute,
  runTableExportRoute,
  getTableExportRoute,
  deleteTableExportRoute,
  downloadTableExportArtifactRoute,
  queryTablePagesRoute,
] as const;
