import {
  admitComputeArtifactRoute,
  authorizeArtifactLifecycleRoute,
  authorizeRuntimeImageRoute,
  computeOperationsPostureRoute,
  createArtifactVersionRoute,
  evaluateSandboxPostureRoute,
  previewComputeArtifactRoute,
  recordComputeProvenanceRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import {
  admitComputeArtifact,
  authorizeArtifactLifecycle,
  authorizeRuntimeImage,
  computeOperationsPosture,
  createArtifactVersion,
  evaluateSandboxPosture,
  recordComputeProvenance,
  safeArtifactPreview,
} from "../../services/compute-artifact-trust";

function trustBody(
  data: { outcome: "accepted" | "denied" } & Record<string, unknown>,
) {
  if (data.outcome === "denied")
    return { code: data.code, outcome: "denied" as const };
  const body: Record<string, unknown> = { outcome: "accepted" };
  for (const key of [
    "version",
    "currentVersion",
    "contentDisposition",
    "sandbox",
    "runtimeDigest",
    "outputHash",
  ]) {
    if (data[key] !== undefined) body[key] = data[key];
  }
  return body;
}

export function registerComputeArtifactSurfaceRoutes(app: RomeoApi): void {
  app.openapi(evaluateSandboxPostureRoute, (context) => {
    const data = evaluateSandboxPosture(context.req.valid("json"));
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(authorizeRuntimeImageRoute, (context) => {
    const data = authorizeRuntimeImage(context.req.valid("json"));
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(admitComputeArtifactRoute, (context) => {
    const data = admitComputeArtifact(context.req.valid("json"));
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(recordComputeProvenanceRoute, (context) => {
    const body = context.req.valid("json");
    const data = recordComputeProvenance({
      codeHash: body.codeHash,
      dependencyManifest: body.dependencyManifest,
      initiatingRunId: body.initiatingRunId,
      inputHashes: body.inputHashes,
      outputHash: body.outputHash,
      policyVersion: body.policyVersion,
      runtimeDigest: body.runtimeDigest,
      transformations: body.transformations,
      ...(body.initiatingModelId === undefined
        ? {}
        : { initiatingModelId: body.initiatingModelId }),
      ...(body.initiatingToolId === undefined
        ? {}
        : { initiatingToolId: body.initiatingToolId }),
    });
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(createArtifactVersionRoute, (context) => {
    const data = createArtifactVersion(context.req.valid("json"));
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(previewComputeArtifactRoute, (context) => {
    const data = safeArtifactPreview(context.req.valid("json"));
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(authorizeArtifactLifecycleRoute, (context) => {
    const body = context.req.valid("json");
    const data = authorizeArtifactLifecycle({
      action: body.action,
      backupChecked: body.backupChecked,
      dualControl: body.dualControl,
      legalHold: body.legalHold,
      now: new Date().toISOString(),
      orphanedStaging: body.orphanedStaging,
      quotaBytes: body.quotaBytes,
      usedBytes: body.usedBytes,
      ...(body.retentionUntil === undefined
        ? {}
        : { retentionUntil: body.retentionUntil }),
    });
    return context.json({ data: trustBody(data) }, 200);
  });

  app.openapi(computeOperationsPostureRoute, (context) => {
    const body = context.req.valid("json");
    const data = computeOperationsPosture({
      capacityRemaining: body.capacityRemaining,
      cleanupBacklog: body.cleanupBacklog,
      imageAvailable: body.imageAvailable,
      leaseLagMs: body.leaseLagMs,
      queueLagMs: body.queueLagMs,
      resourcePressure: body.resourcePressure,
      workerHealthy: body.workerHealthy,
      ...(body.lastRejectionCode === undefined
        ? {}
        : { lastRejectionCode: body.lastRejectionCode }),
    });
    return context.json({ data }, 200);
  });
}
