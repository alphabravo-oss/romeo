import {
  claimBrowserAutomationTaskRoute,
  completeBrowserAutomationTaskRoute,
  createBrowserAutomationArtifactUploadRoute,
  expireBrowserAutomationTasksRoute,
  failBrowserAutomationTaskRoute,
  getBrowserAutomationPostureRoute,
  readBrowserAutomationArtifactRoute,
  renewBrowserAutomationTaskLeaseRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerBrowserAutomationRoutes(app: RomeoApi): void {
  app.openapi(getBrowserAutomationPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .browserAutomation.posture(subject);
    return context.json({ data });
  });

  app.openapi(claimBrowserAutomationTaskRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? { leaseSeconds: 300 };
    const data = await context.get("services").browserAutomation.claim({
      subject,
      leaseSeconds: body.leaseSeconds,
    });
    return context.json({ data });
  });

  app.openapi(renewBrowserAutomationTaskLeaseRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? { leaseSeconds: 300 };
    const data = await context.get("services").browserAutomation.renewLease({
      subject,
      jobId: context.req.valid("param").jobId,
      leaseSeconds: body.leaseSeconds,
    });
    return context.json({ data });
  });

  app.openapi(createBrowserAutomationArtifactUploadRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .browserAutomation.createArtifactUpload({
        subject,
        jobId: context.req.valid("param").jobId,
        type: body.type,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
      });
    return context.json({ data }, 202);
  });

  app.openapi(readBrowserAutomationArtifactRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").browserAutomation.readArtifact({
      subject,
      artifactId: context.req.valid("param").artifactId,
    });
    return new Response(toArrayBuffer(data.bytes), {
      headers: {
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${artifactFileName(data.artifact)}"`,
        "content-length": String(data.bytes.byteLength),
        "content-type": data.artifact.contentType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.openapi(completeBrowserAutomationTaskRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").browserAutomation.complete({
      subject,
      jobId: context.req.valid("param").jobId,
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
  });

  app.openapi(failBrowserAutomationTaskRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").browserAutomation.fail({
      subject,
      jobId: context.req.valid("param").jobId,
      errorCode: body.errorCode,
    });
    return context.json({ data });
  });

  app.openapi(expireBrowserAutomationTasksRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {
      queuedTimeoutSeconds: 86_400,
      runningTimeoutSeconds: 3_600,
      limit: 100,
    };
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
