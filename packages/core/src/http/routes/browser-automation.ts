import type { RomeoApi } from "../context";
import {
  claimBrowserAutomationTaskSchema,
  completeBrowserAutomationTaskSchema,
  createBrowserAutomationArtifactUploadSchema,
  expireBrowserAutomationTasksSchema,
  failBrowserAutomationTaskSchema,
} from "../schemas";

export function registerBrowserAutomationRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/browser-automation/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .browserAutomation.posture(subject);
    return context.json({ data });
  });

  app.post("/api/v1/browser-automation-tasks/claim", async (context) => {
    const subject = context.get("subject");
    const body = claimBrowserAutomationTaskSchema.parse(
      await context.req.json().catch(() => ({})),
    );
    const data = await context.get("services").browserAutomation.claim({
      subject,
      leaseSeconds: body.leaseSeconds,
    });
    return context.json({ data });
  });

  app.post(
    "/api/v1/browser-automation-tasks/:jobId/renew-lease",
    async (context) => {
      const subject = context.get("subject");
      const body = claimBrowserAutomationTaskSchema.parse(
        await context.req.json().catch(() => ({})),
      );
      const data = await context.get("services").browserAutomation.renewLease({
        subject,
        jobId: context.req.param("jobId"),
        leaseSeconds: body.leaseSeconds,
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/browser-automation-tasks/:jobId/artifacts/uploads",
    async (context) => {
      const subject = context.get("subject");
      const body = createBrowserAutomationArtifactUploadSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .browserAutomation.createArtifactUpload({
          subject,
          jobId: context.req.param("jobId"),
          type: body.type,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
        });
      return context.json({ data }, 202);
    },
  );

  app.get(
    "/api/v1/browser-automation-artifacts/:artifactId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .browserAutomation.readArtifact({
          subject,
          artifactId: context.req.param("artifactId"),
        });
      return new Response(toArrayBuffer(data.bytes), {
        headers: {
          "cache-control": "private, max-age=300",
          "content-disposition": `inline; filename="${artifactFileName(data.artifact)}"`,
          "content-length": String(data.bytes.byteLength),
          "content-type":
            data.artifact.contentType ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        },
      });
    },
  );

  app.post(
    "/api/v1/browser-automation-tasks/:jobId/complete",
    async (context) => {
      const subject = context.get("subject");
      const body = completeBrowserAutomationTaskSchema.parse(
        await context.req.json(),
      );
      const data = await context.get("services").browserAutomation.complete({
        subject,
        jobId: context.req.param("jobId"),
        result: {
          ...(body.result.artifactCount === undefined
            ? {}
            : { artifactCount: body.result.artifactCount }),
          ...(body.result.artifacts === undefined
            ? {}
            : {
                artifacts: body.result.artifacts.map((artifact) => ({
                  artifactId: artifact.artifactId,
                  type: artifact.type,
                  ...(artifact.contentType === undefined
                    ? {}
                    : { contentType: artifact.contentType }),
                  ...(artifact.sizeBytes === undefined
                    ? {}
                    : { sizeBytes: artifact.sizeBytes }),
                })),
              }),
          ...(body.result.capturedBytes === undefined
            ? {}
            : { capturedBytes: body.result.capturedBytes }),
          ...(body.result.durationMs === undefined
            ? {}
            : { durationMs: body.result.durationMs }),
          ...(body.result.finalOrigin === undefined
            ? {}
            : { finalOrigin: body.result.finalOrigin }),
          ...(body.result.navigationCount === undefined
            ? {}
            : { navigationCount: body.result.navigationCount }),
          ...(body.result.networkDeniedCount === undefined
            ? {}
            : { networkDeniedCount: body.result.networkDeniedCount }),
          ...(body.result.outputKeys === undefined
            ? {}
            : { outputKeys: body.result.outputKeys }),
          ...(body.result.redactionApplied === undefined
            ? {}
            : { redactionApplied: body.result.redactionApplied }),
        },
      });
      return context.json({ data });
    },
  );

  app.post("/api/v1/browser-automation-tasks/:jobId/fail", async (context) => {
    const subject = context.get("subject");
    const body = failBrowserAutomationTaskSchema.parse(
      await context.req.json(),
    );
    const data = await context.get("services").browserAutomation.fail({
      subject,
      jobId: context.req.param("jobId"),
      errorCode: body.errorCode,
    });
    return context.json({ data });
  });

  app.post("/api/v1/browser-automation-tasks/expire", async (context) => {
    const subject = context.get("subject");
    const body = expireBrowserAutomationTasksSchema.parse(
      await context.req.json().catch(() => ({})),
    );
    const data = await context.get("services").browserAutomation.expire({
      subject,
      queuedTimeoutSeconds: body.queuedTimeoutSeconds,
      runningTimeoutSeconds: body.runningTimeoutSeconds,
      limit: body.limit,
    });
    return context.json({ data });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function artifactFileName(artifact: {
  artifactId: string;
  contentType?: string;
  type: string;
}): string {
  const extension = artifactExtension(artifact.contentType);
  return `romeo-browser-${artifact.type}-${artifact.artifactId.replace(/"/gu, "")}.${extension}`;
}

function artifactExtension(contentType: string | undefined): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/gzip":
      return "gz";
    case "application/json":
      return "json";
    case "application/x-ndjson":
      return "ndjson";
    case "application/zip":
      return "zip";
    default:
      return "bin";
  }
}
