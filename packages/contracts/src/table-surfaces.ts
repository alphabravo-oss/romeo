import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const metadata = { security: authenticationSecurity };

export const ServerTableSavedViewSchema = z
  .strictObject({
    id: identifier,
    resource: identifier,
    name: z.string().trim().min(1).max(80),
    source: z.enum(["server", "local_fallback"]),
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
            localViews: z
              .array(
                z.strictObject({
                  name: z.string().trim().min(1).max(80),
                  globalFilter: z.string().max(300).optional(),
                  pageSize: z.number().int().optional(),
                  density: z.enum(["comfortable", "compact"]).optional(),
                  columnVisibility: z.record(z.string(), z.boolean()).optional(),
                  sorting: z
                    .array(
                      z.strictObject({
                        id: identifier,
                        desc: z.boolean(),
                      }),
                    )
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
            name: z.string().trim().min(1).max(80),
            globalFilter: z.string().max(300).optional(),
            pageSize: z.number().int().optional(),
            density: z.enum(["comfortable", "compact"]).optional(),
            columnVisibility: z.record(z.string(), z.boolean()).optional(),
            sorting: z
              .array(z.strictObject({ id: identifier, desc: z.boolean() }))
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

export const TableExportJobSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z.enum(["table_export_must_be_async"]).optional(),
    jobId: identifier.optional(),
    state: z
      .enum(["queued", "running", "artifact_ready", "failed", "expired"])
      .optional(),
    percent: z.number().int().min(0).max(100).optional(),
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
            resource: identifier,
            mode: z
              .enum(["browser_csv", "async_artifact"])
              .default("async_artifact"),
            estimatedRows: z.number().int().min(0).max(10_000_000),
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
    200: jsonResponse("Table export job", dataEnvelope(TableExportJobSchema)),
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
  createTableExportRoute,
  runTableExportRoute,
  getTableExportRoute,
  queryTablePagesRoute,
] as const;
