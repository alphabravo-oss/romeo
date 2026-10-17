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
      desiredWafMode: z.enum(["disabled", "monitor", "block"]),
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
    checks: z.array(EdgeSecurityPostureCheckSchema),
    redaction: z.strictObject({
      rawAllowedOriginsReturned: z.literal(false),
      rawAppOriginReturned: z.literal(false),
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
