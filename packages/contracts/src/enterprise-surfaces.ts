import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const metadata = { security: authenticationSecurity };

export const RealtimeSessionDecisionSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z
      .enum(["capability_platform_disabled", "realtime_runtime_uninstalled"])
      .optional(),
    fallback: z.enum(["none", "batch_stt_tts"]),
    retention: z.enum(["none", "transcript_only", "audio_governed"]).optional(),
  })
  .openapi("RealtimeSessionDecision");

export const createRealtimeSessionRoute = createRoute({
  ...metadata,
  tags: ["Realtime"],
  method: "post",
  path: "/api/v1/realtime/sessions",
  operationId: "realtime.createSession",
  summary: "Create an authenticated realtime voice session or fail closed",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            retention: z
              .enum(["none", "transcript_only", "audio_governed"])
              .default("none"),
            durationSeconds: z.number().int().min(1).max(1_800).default(30),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Realtime session decision",
      dataEnvelope(RealtimeSessionDecisionSchema),
    ),
    ...standardErrorResponses,
  },
});

export const ComputeJobDecisionSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z
      .enum([
        "capability_platform_disabled",
        "compute_runtime_uninstalled",
        "compute_egress_denied",
        "compute_lease_lost",
      ])
      .optional(),
    jobId: identifier.optional(),
  })
  .openapi("ComputeJobDecision");

export const createComputeJobRoute = createRoute({
  ...metadata,
  tags: ["Compute"],
  method: "post",
  path: "/api/v1/compute/jobs",
  operationId: "compute.createJob",
  summary: "Queue an isolated compute job or fail closed when uninstalled",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            imageDigest: z.string().trim().min(16).max(200),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Compute job decision", dataEnvelope(ComputeJobDecisionSchema)),
    ...standardErrorResponses,
  },
});

export const ComparePreflightDecisionSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z
      .enum([
        "capability_platform_disabled",
        "compare_preflight_failed",
        "compare_cost_cap_exceeded",
      ])
      .optional(),
    estimatedMicroUsd: z.number().int().nonnegative().optional(),
    legIds: z.array(identifier).optional(),
    failedLegIds: z.array(identifier).optional(),
  })
  .openapi("ComparePreflightDecision");

export const createCompareSessionRoute = createRoute({
  ...metadata,
  tags: ["Compare"],
  method: "post",
  path: "/api/v1/run-groups",
  operationId: "compare.createSession",
  summary: "Preflight a multi-model compare session before any child starts",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            modelIds: z.array(identifier).min(2).max(8),
            maxAggregateMicroUsd: z.number().int().positive().max(1_000_000),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Compare preflight decision",
      dataEnvelope(ComparePreflightDecisionSchema),
    ),
    ...standardErrorResponses,
  },
});

export const FirewallOutputEvaluationSchema = z
  .strictObject({
    action: z.enum(["hold", "release", "block"]),
    code: z
      .enum(["firewall_output_blocked", "content_policy_unavailable"])
      .optional(),
    detectors: z.array(z.string()).optional(),
    releasedCharacters: z.number().int().nonnegative(),
  })
  .openapi("FirewallOutputEvaluation");

export const evaluateFirewallOutputRoute = createRoute({
  ...metadata,
  tags: ["Content Policy"],
  method: "post",
  path: "/api/v1/admin/content-policy/output-buffer/evaluate",
  summary: "Evaluate streamed output against rolling detectors before persist",
  operationId: "firewall.evaluateOutput",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            mode: z.enum(["rolling", "strict"]).default("rolling"),
            chunks: z.array(z.string().max(4_096)).min(1).max(64),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Firewall output evaluation",
      dataEnvelope(FirewallOutputEvaluationSchema),
    ),
    ...standardErrorResponses,
  },
});

export const KnowledgeAclPrefilterSchema = z
  .strictObject({
    allowedDocumentCount: z.number().int().nonnegative(),
    deniedCount: z.number().int().nonnegative(),
    reasonCode: z
      .enum([
        "knowledge_acl_denied",
        "knowledge_acl_stale",
        "knowledge_acl_revoked",
        "knowledge_acl_tombstoned",
      ])
      .optional(),
  })
  .openapi("KnowledgeAclPrefilter");

export const prefilterKnowledgeAclRoute = createRoute({
  ...metadata,
  tags: ["Knowledge"],
  method: "post",
  path: "/api/v1/knowledge/acl/prefilter",
  operationId: "knowledge.prefilterAcl",
  summary: "Resolve allowed knowledge document IDs before rank",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            documentIds: z.array(identifier).min(1).max(200),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Knowledge ACL prefilter",
      dataEnvelope(KnowledgeAclPrefilterSchema),
    ),
    ...standardErrorResponses,
  },
});

export const TrustPostureSchema = z
  .strictObject({
    keys: z.enum(["verified", "failed", "stale", "not_configured", "not_applicable"]),
    residency: z.enum([
      "verified",
      "failed",
      "stale",
      "not_configured",
      "not_applicable",
    ]),
    dlp: z.enum(["verified", "failed", "stale", "not_configured", "not_applicable"]),
    acl: z.enum(["verified", "failed", "stale", "not_configured", "not_applicable"]),
    syntheticGreen: z.literal(false),
  })
  .openapi("TrustPosture");

export const getTrustPostureRoute = createRoute({
  ...metadata,
  tags: ["Trust"],
  method: "get",
  path: "/api/v1/admin/trust/posture",
  operationId: "trust.getPosture",
  summary: "Report key, residency, DLP, and ACL posture without synthetic green",
  responses: {
    200: jsonResponse("Trust posture", dataEnvelope(TrustPostureSchema)),
    ...standardErrorResponses,
  },
});

export const ImageJobDecisionSchema = z
  .strictObject({
    outcome: z.enum(["accepted", "denied"]),
    code: z
      .enum([
        "capability_platform_disabled",
        "image_job_cancelled",
        "image_job_source_revoked",
        "file_not_ready",
      ])
      .optional(),
    jobId: identifier.optional(),
    state: z
      .enum([
        "queued",
        "running",
        "cancelling",
        "cancelled",
        "completed",
        "failed",
      ])
      .optional(),
  })
  .openapi("ImageJobDecision");

export const createImageJobRoute = createRoute({
  ...metadata,
  tags: ["Images"],
  method: "post",
  path: "/api/v1/images/jobs",
  operationId: "images.createJob",
  summary: "Create a file-ref image generation, edit, or variation job",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            workspaceId: identifier,
            kind: z.enum(["generate", "edit", "variation"]),
            sourceFileId: identifier.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Image job decision", dataEnvelope(ImageJobDecisionSchema)),
    ...standardErrorResponses,
  },
});

export const cancelImageJobRoute = createRoute({
  ...metadata,
  tags: ["Images"],
  method: "post",
  path: "/api/v1/images/jobs/{jobId}/cancel",
  operationId: "images.cancelJob",
  summary: "Cancel a durable image job",
  request: { params: z.strictObject({ jobId: identifier }) },
  responses: {
    200: jsonResponse("Image job decision", dataEnvelope(ImageJobDecisionSchema)),
    ...standardErrorResponses,
  },
});

export const enterpriseSurfaceRoutes = [
  createRealtimeSessionRoute,
  createComputeJobRoute,
  createCompareSessionRoute,
  evaluateFirewallOutputRoute,
  prefilterKnowledgeAclRoute,
  getTrustPostureRoute,
  createImageJobRoute,
  cancelImageJobRoute,
] as const;
