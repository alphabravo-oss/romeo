import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const nonNegativeInteger = z.number().int().nonnegative();
const boundedPositiveInteger = (maximum: number) =>
  z.number().int().min(1).max(maximum);
const evidenceCheckStatus = z.enum(["failed", "passed", "unknown"]);

export const EdgeSecurityPostureCheckSchema = z
  .strictObject({
    id: z.string(),
    status: z.enum(["pass", "warn"]),
    severity: z.enum(["info", "warning"]),
    message: z.string(),
    details: z.record(
      z.string(),
      z.union([z.boolean(), z.number(), z.string()]),
    ),
  })
  .openapi("EdgeSecurityPostureCheck");

const LiveEdgeEvidenceSchema = z.strictObject({
  configured: z.boolean(),
  source: z.enum(["configured_file", "not_configured"]),
  status: z.enum([
    "failed",
    "invalid",
    "not_configured",
    "planned",
    "satisfied",
  ]),
  schemaVersion: z.literal("romeo.live-edge-enforcement.v1").optional(),
  generatedAt: z.iso.datetime().optional(),
  evidenceStatus: z.enum(["failed", "passed", "planned", "unknown"]).optional(),
  mode: z.enum(["dry-run", "live", "unknown"]).optional(),
  invalidReason: z
    .enum(["invalid_json", "read_failed", "schema_mismatch"])
    .optional(),
  failureCodes: z.array(z.string()),
  target: z.strictObject({
    deployment: z.enum(["edge", "unknown"]),
    originConfigured: z.boolean(),
  }),
  checks: z.strictObject({
    total: nonNegativeInteger,
    requiredTotal: nonNegativeInteger,
    requiredPresent: nonNegativeInteger,
    missingRequired: z.array(
      z.enum([
        "security_headers_present",
        "waf_or_gateway_probe_blocked",
        "oversized_request_rejected",
        "public_rate_limit_enforced",
        "raw_probe_payload_not_retained",
      ]),
    ),
  }),
  securityHeaders: z.strictObject({
    checked: z.boolean(),
    status: evidenceCheckStatus,
    matchedRequiredCount: nonNegativeInteger,
    missingRequiredCount: nonNegativeInteger,
    missingRequired: z.array(
      z.enum([
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "cross-origin-opener-policy",
        "permissions-policy",
      ]),
    ),
    hstsChecked: z.boolean(),
    headerValuesReturned: z.boolean(),
  }),
  waf: z.strictObject({
    checked: z.boolean(),
    status: evidenceCheckStatus,
    httpStatus: nonNegativeInteger.optional(),
    expectedStatusCount: nonNegativeInteger,
    expectedHeaderPresent: z.boolean().optional(),
    responseBodyReturned: z.boolean(),
  }),
  requestBodyLimit: z.strictObject({
    checked: z.boolean(),
    status: evidenceCheckStatus,
    bytesSent: nonNegativeInteger,
    httpStatus: nonNegativeInteger.optional(),
    expectedStatusCount: nonNegativeInteger,
    requestBodyReturned: z.boolean(),
    responseBodyReturned: z.boolean(),
  }),
  rateLimit: z.strictObject({
    checked: z.boolean(),
    status: evidenceCheckStatus,
    attempts: nonNegativeInteger,
    blockedAt: z.number().int().min(1).optional(),
    expectedStatus: nonNegativeInteger.optional(),
    expectedStatusObserved: z.boolean(),
    responseBodyReturned: z.boolean(),
  }),
  redaction: z.strictObject({
    rawApiKeyReturned: z.boolean(),
    rawHeaderValuesReturned: z.boolean(),
    rawProbePayloadReturned: z.boolean(),
    rawQueryValuesReturned: z.boolean(),
    rawRequestBodiesReturned: z.boolean(),
    rawResponseBodiesReturned: z.boolean(),
  }),
});

export const EdgeSecurityPostureReportSchema = z
  .strictObject({
    status: z.enum(["attention_required", "ready"]),
    generatedAt: z.iso.datetime(),
    orgId: z.string(),
    appOrigin: z.strictObject({
      configured: z.boolean(),
      localhost: z.boolean(),
      scheme: z.enum(["http", "https"]),
    }),
    tls: z.strictObject({
      appOriginHttps: z.boolean(),
      hstsEnabled: z.boolean(),
      hstsIncludeSubdomains: z.boolean(),
      hstsMaxAgeSeconds: nonNegativeInteger,
      hstsPreload: z.boolean(),
      termination: z.enum(["app", "ingress", "external_lb"]),
    }),
    proxy: z.strictObject({
      mode: z.enum(["direct", "trusted_proxy"]),
      forwardedHeadersTrusted: z.boolean(),
    }),
    ingress: z.strictObject({
      allowedOriginRuleCount: nonNegativeInteger,
      wafMode: z.enum(["disabled", "monitor", "block"]),
    }),
    limits: z.strictObject({
      files: z.strictObject({
        directUploadMaxBytes: boundedPositiveInteger(1_000_000_000),
        inlineMaxBytes: boundedPositiveInteger(250_000_000),
        messageAttachmentMaxBytes: boundedPositiveInteger(100_000_000),
        resumableUploadMaxBytes: boundedPositiveInteger(5_000_000_000),
      }),
      rateLimit: z.strictObject({
        authenticatedMax: boundedPositiveInteger(250_000),
        authMax: boundedPositiveInteger(100_000),
        distributed: z.boolean(),
        driver: z.enum(["disabled", "memory", "valkey"]),
        publicMax: boundedPositiveInteger(100_000),
        webhookMax: boundedPositiveInteger(250_000),
        windowSeconds: boundedPositiveInteger(86_400),
      }),
      requestBodyMaxBytes: boundedPositiveInteger(250_000_000),
    }),
    headers: z.strictObject({
      contentTypeOptions: z.literal("nosniff"),
      crossOriginOpenerPolicy: z.literal("same-origin"),
      frameOptions: z.literal("DENY"),
      permissionsPolicy: z.literal("camera=(), microphone=(), geolocation=()"),
      referrerPolicy: z.literal("no-referrer"),
      strictTransportSecurity: z.boolean(),
    }),
    liveEvidence: LiveEdgeEvidenceSchema,
    checks: z.array(EdgeSecurityPostureCheckSchema),
    redaction: z.strictObject({
      evidenceFileBodyReturned: z.literal(false),
      rawAllowedOriginsReturned: z.literal(false),
      rawAppOriginReturned: z.literal(false),
      rawEvidencePathReturned: z.literal(false),
      rawIngressAnnotationsReturned: z.literal(false),
      rawProxyIpRangesReturned: z.literal(false),
      rawSecretsReturned: z.literal(false),
    }),
  })
  .openapi("EdgeSecurityPostureReport");

export const getEdgeSecurityPostureRoute = createRoute({
  method: "get",
  path: "/api/v1/admin/edge-security/posture",
  operationId: "edgeSecurity.getPosture",
  tags: ["Edge security"],
  security: authenticationSecurity,
  summary: "Get sanitized edge, ingress, WAF, and security-header posture",
  responses: {
    200: jsonResponse(
      "Edge security posture",
      dataEnvelope(EdgeSecurityPostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const edgeSecurityRoutes = [getEdgeSecurityPostureRoute] as const;
