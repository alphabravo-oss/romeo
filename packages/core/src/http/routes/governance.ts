import type { RomeoApi } from "../context";
import type { DataExportRequest } from "../../domain/entities";
import {
  dataExportSchema,
  deleteDataExportPackageSchema,
  executeDataDeletionSchema,
  previewDataDeletionSchema,
  updateRetentionPolicySchema,
} from "../schemas";

export function registerGovernanceRoutes(app: RomeoApi): void {
  app.get("/api/v1/governance/retention", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.retentionPolicy(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/governance/retention", async (context) => {
    const subject = context.get("subject");
    const body = updateRetentionPolicySchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .governance.updateRetentionPolicy({
        subject,
        auditLogRetentionDays: body.auditLogRetentionDays,
      });
    return context.json({ data });
  });

  app.post("/api/v1/governance/retention/enforce", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.enforceRetention(subject);
    return context.json({ data });
  });

  app.post("/api/v1/governance/data-deletions/preview", async (context) => {
    const subject = context.get("subject");
    const body = previewDataDeletionSchema.parse(await context.req.json());
    const data = await context.get("services").governance.previewDataDeletion({
      subject,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
    });
    return context.json({ data });
  });

  app.post("/api/v1/governance/data-deletions/execute", async (context) => {
    const subject = context.get("subject");
    const body = executeDataDeletionSchema.parse(await context.req.json());
    const data = await context.get("services").governance.executeDataDeletion({
      subject,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      confirmResourceId: body.confirmResourceId,
    });
    return context.json({ data });
  });

  app.get("/api/v1/governance/data-rights/coverage", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.dataRightsCoverage(subject);
    return context.json({ data });
  });

  app.post("/api/v1/governance/data-exports/preview", async (context) => {
    const subject = context.get("subject");
    const body = dataExportSchema.parse(await context.req.json());
    const data = await context.get("services").governance.previewDataExport({
      subject,
      request: dataExportRequest(body),
    });
    return context.json({ data });
  });

  app.post("/api/v1/governance/data-exports/execute", async (context) => {
    const subject = context.get("subject");
    const body = dataExportSchema.parse(await context.req.json());
    const data = await context.get("services").governance.executeDataExport({
      subject,
      request: dataExportRequest(body),
    });
    return context.json({ data });
  });

  app.get("/api/v1/governance/data-exports/packages", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.listDataExportPackages(subject);
    return context.json({ data });
  });

  app.post("/api/v1/governance/data-exports/packages", async (context) => {
    const subject = context.get("subject");
    const body = dataExportSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .governance.createDataExportPackage({
        subject,
        request: dataExportRequest(body),
      });
    return context.json({ data });
  });

  app.delete(
    "/api/v1/governance/data-exports/packages/:packageId",
    async (context) => {
      const subject = context.get("subject");
      const body = deleteDataExportPackageSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .governance.deleteDataExportPackage({
          subject,
          packageId: context.req.param("packageId"),
          confirmPackageId: body.confirmPackageId,
        });
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/governance/data-exports/packages/:packageId/content",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .governance.readDataExportPackage({
          subject,
          packageId: context.req.param("packageId"),
        });
      return new Response(toArrayBuffer(data.bytes), {
        headers: {
          "cache-control": "private, max-age=300",
          "content-disposition": `attachment; filename="${data.fileName.replace(/"/gu, "")}"`,
          "content-length": String(data.bytes.byteLength),
          "content-type": `${data.contentType}; charset=utf-8`,
          "x-content-type-options": "nosniff",
        },
      });
    },
  );

  app.get("/api/v1/governance/compliance-report", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.complianceReport(subject);
    return context.json({ data });
  });

  app.get("/api/v1/governance/compliance-report.csv", async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.complianceReportCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv);
  });

  app.get("/api/v1/access-review", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").governance.accessReview(subject);
    return context.json({ data });
  });

  app.get("/api/v1/access-review.csv", async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.accessReviewCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv);
  });

  app.get("/api/v1/access-review/report", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.accessReviewReport(subject);
    return context.json({ data });
  });

  app.get("/api/v1/access-review/report.csv", async (context) => {
    const subject = context.get("subject");
    const csv = await context
      .get("services")
      .governance.accessReviewReportCsv(subject);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv);
  });

  app.get("/api/v1/governance/identity-lifecycle-policy", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .governance.identityLifecyclePolicy(subject);
    return context.json({ data });
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
