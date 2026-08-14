import {
  ServerTableSavedViewSchema,
  TableExportJobSchema,
  createTableExportRoute,
  getTableExportRoute,
  listTableViewsRoute,
  queryTablePagesRoute,
  replaceTableViewRoute,
  runTableExportRoute,
} from "@romeo/contracts";

import { ApiError } from "../../errors";
import type { RomeoApi } from "../context";
import { applyIdempotencyHeaders } from "../idempotency-response";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { parseInventoriedTablePageRequest } from "../../services/inventoried-table-page-service";
import type { TableExportJob } from "../../services/server-table-export-job";
import type { ServerTableSavedView } from "../../services/server-table-saved-view";

export function registerTableSurfaceRoutes(app: RomeoApi): void {
  app.openapi(listTableViewsRoute, async (context) => {
    const body = context.req.valid("json");
    const views = await context.get("services").tableViews.list({
      subject: context.get("subject"),
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.localViews === undefined ? {} : { localFallback: body.localViews }),
    });
    return context.json(
      { data: views.map(publicSavedView) },
      200,
    );
  });

  app.openapi(replaceTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const stored = await context.get("services").tableViews.replace({
      subject: context.get("subject"),
      workspaceId: body.workspaceId,
      resource: body.resource,
      view: {
        name: body.name,
        ...(body.globalFilter === undefined ? {} : { globalFilter: body.globalFilter }),
        ...(body.pageSize === undefined ? {} : { pageSize: body.pageSize }),
        ...(body.density === undefined ? {} : { density: body.density }),
        ...(body.columnVisibility === undefined
          ? {}
          : { columnVisibility: body.columnVisibility }),
        ...(body.sorting === undefined ? {} : { sorting: body.sorting }),
      },
    });
    if ("outcome" in stored)
      throw new ApiError(
        "invalid_request",
        "The saved view is invalid.",
        400,
      );
    return context.json({ data: publicSavedView(stored) }, 200);
  });

  app.openapi(createTableExportRoute, async (context) => {
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      undefined,
    );
    const result = await context.get("services").idempotency.execute({
      subject: context.get("subject"),
      operation: "table.exports.create",
      ...(key === undefined ? {} : { key }),
      request: {
        workspaceId: body.workspaceId,
        resource: body.resource,
        mode: body.mode,
        estimatedRows: body.estimatedRows,
      },
      responseStatus: 200,
      work: async () =>
        context.get("services").tableExports.create({
          subject: context.get("subject"),
          workspaceId: body.workspaceId,
          resource: body.resource,
          mode: body.mode,
          estimatedRows: body.estimatedRows,
          sort: body.sort,
          filters: body.filters,
        }),
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: publicExport(result.value) }, 200);
  });

  app.openapi(runTableExportRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const job = await context.get("services").tableExports.run({
      subject: context.get("subject"),
      jobId,
    });
    return context.json({ data: publicExport({ outcome: "accepted", job }) }, 200);
  });

  app.openapi(getTableExportRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const job = await context.get("services").tableExports.get({
      subject: context.get("subject"),
      jobId,
    });
    return context.json({ data: publicExport({ outcome: "accepted", job }) }, 200);
  });

  app.openapi(queryTablePagesRoute, async (context) => {
    const page = await context.get("services").tablePages.query(
      context.get("subject"),
      parseInventoriedTablePageRequest(context.req.valid("json")),
    );
    return context.json({ data: page }, 200);
  });
}

function publicSavedView(view: ServerTableSavedView) {
  return ServerTableSavedViewSchema.parse({
    id: view.id,
    resource: view.resource,
    name: view.name,
    source: view.source,
    query: view.query,
    presentation: view.presentation,
  });
}

function publicExport(
  result:
    | { outcome: "denied"; code: "table_export_must_be_async" }
    | { outcome: "accepted"; job: TableExportJob },
) {
  if (result.outcome === "denied")
    return TableExportJobSchema.parse({
      outcome: "denied",
      code: result.code,
    });
  return TableExportJobSchema.parse({
    outcome: "accepted",
    jobId: result.job.id,
    state: result.job.state,
    percent: result.job.percent,
    ...(result.job.artifactId === undefined
      ? {}
      : { artifactId: result.job.artifactId }),
    ...(result.job.expiresAt === undefined
      ? {}
      : { expiresAt: result.job.expiresAt }),
  });
}
