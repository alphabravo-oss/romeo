import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const metadata = { security: authenticationSecurity };
const requestBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const previewRealtimeAdapterRoute = createRoute({
  ...metadata,
  tags: ["Realtime"],
  method: "post",
  path: "/api/v1/realtime/adapters/preview",
  operationId: "realtime.adapters.preview",
  summary: "Preview native or pipeline realtime adapter selection",
  request: {
    body: requestBody(
      z.strictObject({
        nativeAvailable: z.boolean(),
        pipelineAvailable: z.boolean(),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Realtime adapter preview",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["accepted", "denied"]),
          adapter: z.enum(["native", "pipeline"]).optional(),
          fallback: z.enum(["batch_stt_tts"]).optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const previewCompareSynthesisRoute = createRoute({
  ...metadata,
  tags: ["Compare"],
  method: "post",
  path: "/api/v1/run-groups/synthesis/preview",
  operationId: "compare.synthesis.preview",
  summary: "Preview an independently authorized compare synthesis",
  request: {
    body: requestBody(
      z.strictObject({
        candidateIds: z.array(identifier).min(1).max(8),
        candidateHashes: z.array(identifier).min(1).max(8),
        providerAuthorized: z.boolean(),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Compare synthesis preview",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["accepted", "denied"]),
          citations: z
            .array(z.strictObject({ candidateId: identifier, hash: identifier }))
            .optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const evaluateKnowledgeAclFreshnessRoute = createRoute({
  ...metadata,
  tags: ["Knowledge"],
  method: "post",
  path: "/api/v1/knowledge/acl/freshness",
  operationId: "knowledge.acl.freshness",
  summary: "Evaluate ACL freshness and fail closed for restricted sources",
  request: {
    body: requestBody(
      z.strictObject({
        sensitivity: z.enum(["restricted", "internal", "public"]),
        ageMs: z.number().int().min(0),
        maxStalenessMs: z.number().int().min(0),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "ACL freshness",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["fresh", "stale"]),
          failClosed: z.boolean().optional(),
          code: z.literal("knowledge_acl_stale").optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const previewCryptoShredRoute = createRoute({
  ...metadata,
  tags: ["Trust"],
  method: "post",
  path: "/api/v1/admin/trust/crypto/shred",
  operationId: "trust.crypto.shred.preview",
  summary: "Preview crypto-shred after hold, backup, and dual-approval checks",
  request: {
    body: requestBody(
      z.strictObject({
        legalHold: z.boolean(),
        backupChecked: z.boolean(),
        approverIds: z.array(identifier).max(8),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Crypto-shred preview",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["accepted", "denied"]),
          externalCopiesClaimed: z.literal(false).optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const sealAuditSegmentRoute = createRoute({
  ...metadata,
  tags: ["Trust"],
  method: "post",
  path: "/api/v1/admin/trust/audit-segments",
  operationId: "trust.auditSegments.seal",
  summary: "Seal a hash-chained audit segment",
  request: {
    body: requestBody(
      z.strictObject({
        eventIds: z.array(identifier).max(500),
        previousHash: z.string().trim().min(1).max(128).optional(),
        signingKeyVersion: z.string().trim().min(1).max(80),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Audit segment",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["accepted", "denied"]),
          code: z.enum(["audit_segment_empty"]).optional(),
          segmentHash: identifier.optional(),
          previousHash: z.string().min(1).max(128).optional(),
          eventCount: z.number().int().nonnegative().optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const checkpointSiemExportRoute = createRoute({
  ...metadata,
  tags: ["Trust"],
  method: "post",
  path: "/api/v1/admin/trust/siem-export",
  operationId: "trust.siemExport.checkpoint",
  summary: "Checkpoint a SIEM or WORM audit-segment export",
  request: {
    body: requestBody(
      z.strictObject({
        attempt: z.number().int().min(0).max(20),
        destination: z.enum(["customer_siem", "worm_compatible"]),
        priorReceiptHash: z.string().trim().min(1).max(128).optional(),
        receiptHash: z.string().trim().min(1).max(128).optional(),
        sealedAt: z.iso.datetime(),
        segmentHash: identifier,
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "SIEM export checkpoint",
      dataEnvelope(
        z.strictObject({
          state: z.enum([
            "duplicate",
            "exported",
            "failed",
            "in_flight",
            "pending",
          ]),
          lagMs: z.number().int().nonnegative(),
          destination: z.enum(["customer_siem", "worm_compatible"]),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const authorizeBreakGlassRoute = createRoute({
  ...metadata,
  tags: ["Trust"],
  method: "post",
  path: "/api/v1/admin/trust/break-glass",
  operationId: "trust.breakGlass.authorize",
  summary: "Authorize time-limited break-glass without disabling mandatory controls",
  request: {
    body: requestBody(
      z.strictObject({
        approverId: identifier,
        reason: z.string().trim().min(1).max(300),
        requestedControls: z.array(z.string().trim().min(1).max(80)).max(16),
        ttlMinutes: z.number().int().min(1).max(1_440),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Break-glass decision",
      dataEnvelope(
        z.strictObject({
          outcome: z.enum(["accepted", "denied"]),
          alerted: z.literal(true).optional(),
          expiresAt: z.iso.datetime().optional(),
          code: z
            .enum([
              "break_glass_mandatory_control",
              "break_glass_reason_required",
              "break_glass_self_approval",
              "break_glass_ttl_exceeded",
            ])
            .optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const enterpriseLifecycleSurfaceRoutes = [
  previewRealtimeAdapterRoute,
  previewCompareSynthesisRoute,
  evaluateKnowledgeAclFreshnessRoute,
  previewCryptoShredRoute,
  sealAuditSegmentRoute,
  checkpointSiemExportRoute,
  authorizeBreakGlassRoute,
] as const;
