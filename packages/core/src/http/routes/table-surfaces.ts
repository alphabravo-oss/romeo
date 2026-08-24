import {
  ServerTableSavedViewSchema,
  TableExportJobSchema,
  createTableExportRoute,
  deleteTableExportRoute,
  deleteTableViewRoute,
  downloadTableExportArtifactRoute,
  getTableExportRoute,
  listTableViewsRoute,
  queryTablePagesRoute,
  replaceTableViewRoute,
  restoreTableViewRoute,
  runTableExportRoute,
  setDefaultTableViewRoute,
  shareTableViewRoute,
} from "@romeo/contracts";

import { ApiError } from "../../errors";
import type { RomeoApi } from "../context";
import { applyIdempotencyHeaders } from "../idempotency-response";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { parseInventoriedTablePageRequest } from "../../services/inventoried-table-page-service";
import type { TableExportJob } from "../../services/server-table-export-job";
import { authorizeTableExportJob } from "../../services/server-table-export-job";
import {
  SAVED_VIEW_SCHEMA_VERSION,
  type ServerTableSavedView,
} from "../../services/server-table-saved-view";

export function registerTableSurfaceRoutes(app: RomeoApi): void {
  app.openapi(listTableViewsRoute, async (context) => {
    const body = context.req.valid("json");
    const views = await context.get("services").tableViews.list({
      subject: context.get("subject"),
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.localViews === undefined
        ? {}
        : {
            localFallback: body.localViews.map((view) => ({
              name: view.name,
              ...(view.columnVisibility === undefined
                ? {}
                : { columnVisibility: view.columnVisibility }),
              ...(view.density === undefined ? {} : { density: view.density }),
              ...(view.globalFilter === undefined
                ? {}
                : { globalFilter: view.globalFilter }),
              ...(view.pageSize === undefined
                ? {}
                : { pageSize: view.pageSize }),
              ...(view.sorting === undefined ? {} : { sorting: view.sorting }),
              ...(view.filters === undefined ? {} : { filters: view.filters }),
            })),
          }),
    });
    return context.json(
      {
        data: views.map((view) =>
          publicSavedView(view, context.get("subject").id),
        ),
      },
      200,
    );
  });

  app.openapi(replaceTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const stored = await context.get("services").tableViews.replace({
      subject: context.get("subject"),
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion }),
      view: {
        name: body.name,
        ...(body.globalFilter === undefined
          ? {}
          : { globalFilter: body.globalFilter }),
        ...(body.pageSize === undefined ? {} : { pageSize: body.pageSize }),
        ...(body.density === undefined ? {} : { density: body.density }),
        ...(body.columnVisibility === undefined
          ? {}
          : { columnVisibility: body.columnVisibility }),
        ...(body.sorting === undefined ? {} : { sorting: body.sorting }),
        ...(body.filters === undefined ? {} : { filters: body.filters }),
        ...(body.viewId === undefined ? {} : { viewId: body.viewId }),
        ...(body.visibility === undefined
          ? {}
          : { visibility: body.visibility }),
        ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
      },
    });
    if ("outcome" in stored)
      throw new ApiError("invalid_request", "The saved view is invalid.", 400);
    return context.json(
      { data: publicSavedView(stored, context.get("subject").id) },
      200,
    );
  });

  app.openapi(deleteTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const { viewId } = context.req.valid("param");
    const deleted = await context.get("services").tableViews.remove({
      subject: context.get("subject"),
      viewId,
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion }),
      ...(body.requestToken === undefined
        ? {}
        : { requestToken: body.requestToken }),
    });
    return context.json({ data: deleted }, 200);
  });

  app.openapi(restoreTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const { viewId } = context.req.valid("param");
    const view = await context.get("services").tableViews.restore({
      subject: context.get("subject"),
      viewId,
      workspaceId: body.workspaceId,
      resource: body.resource,
      undoToken: body.undoToken,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion }),
    });
    return context.json(
      { data: publicSavedView(view, context.get("subject").id) },
      200,
    );
  });

  app.openapi(setDefaultTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const { viewId } = context.req.valid("param");
    const view = await context.get("services").tableViews.setDefault({
      subject: context.get("subject"),
      viewId,
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion }),
      isDefault: body.isDefault,
    });
    return context.json(
      { data: publicSavedView(view, context.get("subject").id) },
      200,
    );
  });

  app.openapi(shareTableViewRoute, async (context) => {
    const body = context.req.valid("json");
    const { viewId } = context.req.valid("param");
    const view = await context.get("services").tableViews.share({
      subject: context.get("subject"),
      viewId,
      workspaceId: body.workspaceId,
      resource: body.resource,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion }),
      visibility: body.visibility,
    });
    return context.json(
      { data: publicSavedView(view, context.get("subject").id) },
      200,
    );
  });

  app.openapi(createTableExportRoute, async (context) => {
    const body = context.req.valid("json");
    const authorization = authorizeTableExportJob({
      mode: body.mode,
      estimatedRows: body.estimatedRows,
    });
    if (authorization.outcome === "denied")
      return context.json({ data: publicExport(authorization) }, 200);
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
        sort: body.sort,
        filters: body.filters,
        ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
        ...(body.search === undefined ? {} : { search: body.search }),
      },
      responseStatus: 202,
      work: async () =>
        context.get("services").tableExports.create({
          subject: context.get("subject"),
          workspaceId: body.workspaceId,
          ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
          resource: body.resource,
          mode: body.mode,
          estimatedRows: body.estimatedRows,
          sort: body.sort,
          filters: body.filters,
          ...(body.search === undefined ? {} : { search: body.search }),
        }),
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: publicExport(result.value) }, 202);
  });

  app.openapi(runTableExportRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const job = await context.get("services").tableExports.run({
      subject: context.get("subject"),
      jobId,
    });
    return context.json(
      { data: publicExport({ outcome: "accepted", job }) },
      200,
    );
  });

  app.openapi(getTableExportRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const job = await context.get("services").tableExports.get({
      subject: context.get("subject"),
      jobId,
    });
    return context.json(
      { data: publicExport({ outcome: "accepted", job }) },
      200,
    );
  });

  app.openapi(deleteTableExportRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const deleted = await context.get("services").tableExports.remove({
      subject: context.get("subject"),
      jobId,
    });
    return context.json({ data: deleted }, 200);
  });

  app.openapi(downloadTableExportArtifactRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const artifact = await context.get("services").tableExports.readArtifact({
      subject: context.get("subject"),
      jobId,
    });
    context.header(
      "content-disposition",
      `attachment; filename="${artifact.fileName}"`,
    );
    context.header("cache-control", "private, no-store");
    context.header("x-content-type-options", "nosniff");
    context.header("content-length", String(artifact.sizeBytes));
    return context.body(artifact.body, 200, {
      "content-type": artifact.contentType,
    });
  });

  app.openapi(queryTablePagesRoute, async (context) => {
    const page = await context
      .get("services")
      .tablePages.query(
        context.get("subject"),
        parseInventoriedTablePageRequest(context.req.valid("json")),
      );
    return context.json({ data: page }, 200);
  });
}

function publicSavedView(view: ServerTableSavedView, subjectId: string) {
  return ServerTableSavedViewSchema.parse({
    id: view.id,
    resource: view.resource,
    ...(view.parentId === undefined ? {} : { parentId: view.parentId }),
    name: view.name,
    source: view.source,
    schemaVersion: SAVED_VIEW_SCHEMA_VERSION,
    visibility: view.visibility,
    isDefault: view.isDefault,
    canEdit: view.ownerUserId === subjectId && view.source === "server",
    version: view.version,
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
    ...(result.job.processedRows === undefined
      ? {}
      : { processedRows: result.job.processedRows }),
    ...(result.job.attemptCount === undefined
      ? {}
      : { attemptCount: result.job.attemptCount }),
    ...(result.job.errorCode === undefined
      ? {}
      : { errorCode: result.job.errorCode }),
    ...(result.job.artifactId === undefined
      ? {}
      : { artifactId: result.job.artifactId }),
    ...(result.job.expiresAt === undefined
      ? {}
      : { expiresAt: result.job.expiresAt }),
  });
}
