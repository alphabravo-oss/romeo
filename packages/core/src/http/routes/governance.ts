import {
  createDataExportPackageRoute,
  deleteDataExportPackageRoute,
  enforceRetentionRoute,
  executeDataDeletionRoute,
  executeDataExportRoute,
  exportAccessReviewCsvRoute,
  exportAccessReviewReportCsvRoute,
  exportComplianceReportCsvRoute,
  getAccessReviewReportRoute,
  getComplianceReportRoute,
  getDataRightsCoverageRoute,
  getIdentityLifecyclePolicyRoute,
  getRetentionPolicyRoute,
  listAccessReviewGrantsRoute,
  listDataExportPackagesRoute,
  previewDataDeletionRoute,
  previewDataExportRoute,
  readDataExportPackageRoute,
  updateRetentionPolicyRoute,
} from "@romeo/contracts";

import type { DataExportRequest } from "../../domain/entities";
import type { RomeoApi } from "../context";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { applyIdempotencyHeaders } from "../idempotency-response";

export function registerGovernanceRoutes(app: RomeoApi): void {
  app.openapi(getRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.retentionPolicy(subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .governance.updateRetentionPolicy({
        subject,
        auditLogRetentionDays: body.auditLogRetentionDays,
        runEventRetentionDays: body.runEventRetentionDays,
        ...(body.fileRetentionDays === undefined
          ? {}
          : { fileRetentionDays: body.fileRetentionDays }),
        ...(body.workspaceFileRetentionDays === undefined
          ? {}
          : { workspaceFileRetentionDays: body.workspaceFileRetentionDays }),
        ...(body.userFileRetentionDays === undefined
          ? {}
          : { userFileRetentionDays: body.userFileRetentionDays }),
      });
    return context.json({ data }, 200);
  });

  app.openapi(enforceRetentionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.enforceRetention(subject);
    return context.json({ data }, 200);
  });

  app.openapi(previewDataDeletionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").governance.previewDataDeletion({
      subject,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(executeDataDeletionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").governance.executeDataDeletion({
      subject,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      confirmResourceId: body.confirmResourceId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(getDataRightsCoverageRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.dataRightsCoverage(subject);
    return context.json({ data }, 200);
  });

  app.openapi(previewDataExportRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").governance.previewDataExport({
      subject,
      request: dataExportRequest(body),
    });
    return context.json({ data }, 200);
  });

  app.openapi(executeDataExportRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      undefined,
    );
    const result = await context.get("services").idempotency.execute({
      subject,
      operation: "exports.execute",
      ...(key === undefined ? {} : { key }),
      request: dataExportRequest(body),
      responseStatus: 200,
      work: () =>
        context.get("services").governance.executeDataExport({
          subject,
          request: dataExportRequest(body),
        }),
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: result.value }, 200);
  });

  app.openapi(listDataExportPackagesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.listDataExportPackages(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createDataExportPackageRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .governance.createDataExportPackage({
        subject,
        request: dataExportRequest(body),
      });
    return context.json({ data }, 200);
  });

  app.openapi(deleteDataExportPackageRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .governance.deleteDataExportPackage({
        subject,
        packageId: context.req.valid("param").packageId,
        confirmPackageId: body.confirmPackageId,
      });
    return context.json({ data }, 200);
  });

  app.openapi(readDataExportPackageRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.readDataExportPackage({
        subject,
        packageId: context.req.valid("param").packageId,
      });
    context.header("cache-control", "private, max-age=300");
    context.header(
      "content-disposition",
      `attachment; filename="${data.fileName.replace(/"/gu, "")}"`,
    );
    context.header("content-length", String(data.bytes.byteLength));
    context.header("content-type", `${data.contentType}; charset=utf-8`);
    context.header("x-content-type-options", "nosniff");
    return context.body(new TextDecoder().decode(data.bytes), 200);
  });

  app.openapi(getComplianceReportRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.complianceReport(subject);
    return context.json({ data }, 200);
  });

  app.openapi(exportComplianceReportCsvRoute, async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.complianceReportCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv, 200);
  });

  app.openapi(listAccessReviewGrantsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").governance.accessReview(subject);
    return context.json({ data }, 200);
  });

  app.openapi(exportAccessReviewCsvRoute, async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.accessReviewCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv, 200);
  });

  app.openapi(getAccessReviewReportRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.accessReviewReport(subject);
    return context.json({ data }, 200);
  });

  app.openapi(exportAccessReviewReportCsvRoute, async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.accessReviewReportCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv, 200);
  });

  app.openapi(getIdentityLifecyclePolicyRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.identityLifecyclePolicy(subject);
    return context.json({ data }, 200);
  });
}

function dataExportRequest(input: {
  scope: "org" | "workspace";
  workspaceId?: string | undefined;
  includeContent?: boolean | undefined;
  includeObjectBytes?: boolean | undefined;
  maxObjectBytes?: number | undefined;
}): DataExportRequest {
  return {
    scope: input.scope,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    ...(input.includeContent === undefined
      ? {}
      : { includeContent: input.includeContent }),
    ...(input.includeObjectBytes === undefined
      ? {}
      : { includeObjectBytes: input.includeObjectBytes }),
    ...(input.maxObjectBytes === undefined
      ? {}
      : { maxObjectBytes: input.maxObjectBytes }),
  };
}
