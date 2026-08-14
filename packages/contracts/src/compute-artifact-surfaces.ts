import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const digest = z
  .string()
  .trim()
  .regex(/^sha256:[a-f0-9]{64}$/u);
const metadata = { security: authenticationSecurity };
const requestBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

const trustDenial = z.enum([
  "compute_sandbox_posture_denied",
  "compute_runtime_image_unverified",
  "compute_public_package_install_denied",
  "compute_artifact_intake_denied",
  "compute_provenance_incomplete",
  "compute_artifact_version_immutable",
  "compute_artifact_preview_denied",
  "compute_artifact_quota_exceeded",
  "compute_artifact_retention_active",
  "data_deletion_legal_hold",
  "policy_bundle_approval_required",
]);

const decision = z.strictObject({
  outcome: z.enum(["accepted", "denied"]),
  code: trustDenial.optional(),
  version: z.number().int().positive().optional(),
  currentVersion: z.number().int().positive().optional(),
  contentDisposition: z.string().min(1).max(200).optional(),
  sandbox: z.boolean().optional(),
  runtimeDigest: identifier.optional(),
  outputHash: identifier.optional(),
});

export const evaluateSandboxPostureRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/sandbox/posture",
  operationId: "compute.sandbox.posture",
  summary: "Evaluate required Kata guest sandbox posture before claim",
  request: {
    body: requestBody(
      z.strictObject({
        allowPrivilegeEscalation: z.boolean(),
        apparmor: z.boolean(),
        capabilities: z.array(z.string().trim().min(1).max(40)).max(16),
        cpuMillis: z.number().int().min(0).max(120_000),
        diskBytes: z.number().int().min(0).max(8 * 1024 * 1024 * 1024),
        hostNamespaces: z.boolean(),
        jobScopedTmp: z.boolean(),
        memoryBytes: z.number().int().min(0).max(8 * 1024 * 1024 * 1024),
        nonRoot: z.boolean(),
        pidLimit: z.number().int().min(0).max(4_096),
        privileged: z.boolean(),
        rootReadOnly: z.boolean(),
        seccomp: z.boolean(),
        teardown: z.enum(["deterministic", "best_effort"]),
        wallSeconds: z.number().int().min(0).max(3_600),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Sandbox posture", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const authorizeRuntimeImageRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/runtime-images/authorize",
  operationId: "compute.runtimeImages.authorize",
  summary: "Authorize a signed digest-pinned runtime image and package policy",
  request: {
    body: requestBody(
      z.strictObject({
        allowlistedDigests: z.array(digest).max(32),
        approvedOfflineMirror: z.boolean(),
        imageDigest: z.string().trim().min(1).max(200),
        mutableTag: z.boolean(),
        publicPackageInstall: z.boolean(),
        signed: z.boolean(),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Runtime image decision", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const admitComputeArtifactRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/artifacts/intake",
  operationId: "compute.artifacts.intake",
  summary: "Admit a compute artifact after path, size, scan, and DLP checks",
  request: {
    body: requestBody(
      z.strictObject({
        archiveEntries: z.number().int().min(0).max(10_000),
        archiveExpansionBytes: z.number().int().min(0).max(1_000_000_000),
        count: z.number().int().min(0).max(1_000),
        dlp: z.enum(["allow", "block", "unavailable"]),
        malware: z.enum(["clean", "dirty", "unavailable"]),
        mediaType: z.string().trim().min(1).max(200),
        outputPath: z.string().trim().min(1).max(300),
        sha256: z.string().trim().min(1).max(128),
        sizeBytes: z.number().int().min(0).max(1_000_000_000),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Artifact intake", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const recordComputeProvenanceRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/artifacts/provenance",
  operationId: "compute.artifacts.provenance",
  summary: "Record runtime, code, input, output, and policy provenance",
  request: {
    body: requestBody(
      z.strictObject({
        codeHash: z.string().trim().min(1).max(128),
        dependencyManifest: z.array(z.string().trim().min(1).max(120)).max(64),
        initiatingModelId: identifier.optional(),
        initiatingRunId: identifier,
        initiatingToolId: identifier.optional(),
        inputHashes: z.array(z.string().trim().min(1).max(128)).max(32),
        outputHash: z.string().trim().min(1).max(128),
        policyVersion: z.string().trim().min(1).max(80),
        runtimeDigest: z.string().trim().min(1).max(128),
        transformations: z.array(z.string().trim().min(1).max(80)).max(32),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Artifact provenance", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const createArtifactVersionRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/artifacts/versions",
  operationId: "compute.artifacts.createVersion",
  summary: "Create an immutable artifact version instead of overwriting",
  request: {
    body: requestBody(
      z.strictObject({
        artifactId: identifier,
        currentVersion: z.number().int().min(0).max(10_000),
        nextContentHash: z.string().trim().min(1).max(128),
        overwriteRequested: z.boolean(),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Artifact version", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const previewComputeArtifactRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/artifacts/preview",
  operationId: "compute.artifacts.preview",
  summary: "Authorize a hardened or sandboxed artifact preview and download",
  request: {
    body: requestBody(
      z.strictObject({
        contentDisposition: z.string().trim().min(1).max(200),
        filename: z.string().trim().min(1).max(80),
        htmlSameOrigin: z.boolean(),
        htmlSandbox: z.string().max(120),
        mediaType: z.string().trim().min(1).max(200),
        previewer: z.enum(["hardened", "browser_native"]),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Artifact preview", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const authorizeArtifactLifecycleRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/artifacts/lifecycle",
  operationId: "compute.artifacts.lifecycle",
  summary: "Authorize artifact quota, hold, export, delete, shred, or cleanup",
  request: {
    body: requestBody(
      z.strictObject({
        action: z.enum([
          "quota",
          "retention",
          "legal_hold",
          "export",
          "delete",
          "purge",
          "rotate",
          "shred",
          "orphan_cleanup",
        ]),
        backupChecked: z.boolean(),
        dualControl: z.boolean(),
        legalHold: z.boolean(),
        orphanedStaging: z.boolean(),
        quotaBytes: z.number().int().min(0).max(10_000_000_000),
        retentionUntil: z.iso.datetime().optional(),
        usedBytes: z.number().int().min(0).max(10_000_000_000),
      }),
    ),
  },
  responses: {
    200: jsonResponse("Artifact lifecycle", dataEnvelope(decision)),
    ...standardErrorResponses,
  },
});

export const computeOperationsPostureRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/operations/posture",
  operationId: "compute.operations.posture",
  summary: "Report compute worker, lease, image, and cleanup posture",
  request: {
    body: requestBody(
      z.strictObject({
        capacityRemaining: z.number().int().min(0).max(10_000),
        cleanupBacklog: z.number().int().min(0).max(10_000),
        imageAvailable: z.boolean(),
        lastRejectionCode: z.string().trim().min(1).max(80).optional(),
        leaseLagMs: z.number().int().min(0).max(86_400_000),
        queueLagMs: z.number().int().min(0).max(86_400_000),
        resourcePressure: z.boolean(),
        workerHealthy: z.boolean(),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Compute operations posture",
      dataEnvelope(
        z.strictObject({
          alerts: z.array(
            z.enum([
              "worker_unhealthy",
              "lease_lag",
              "queue_lag",
              "resource_pressure",
              "image_unavailable",
              "cleanup_backlog",
              "capacity_exhausted",
            ]),
          ),
          lastRejectionCode: z.string().min(1).max(80).optional(),
          state: z.enum(["healthy", "degraded", "unavailable"]),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const computeArtifactSurfaceRoutes = [
  evaluateSandboxPostureRoute,
  authorizeRuntimeImageRoute,
  admitComputeArtifactRoute,
  recordComputeProvenanceRoute,
  createArtifactVersionRoute,
  previewComputeArtifactRoute,
  authorizeArtifactLifecycleRoute,
  computeOperationsPostureRoute,
] as const;
