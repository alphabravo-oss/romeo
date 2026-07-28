import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const ReadinessCheckSchema = z
  .strictObject({
    id: z.string(),
    status: z.enum(["fail", "pass", "warn"]),
    severity: z.enum(["critical", "info", "warning"]),
    message: z.string(),
    details: z
      .record(z.string(), z.unknown())
      .describe("Sanitized, check-specific readiness evidence."),
  })
  .openapi("ReadinessCheck");

export const ReadinessReportSchema = z
  .strictObject({
    status: z.enum(["attention_required", "ready"]),
    generatedAt: z.iso.datetime(),
    checks: z.array(ReadinessCheckSchema),
  })
  .openapi("ReadinessReport");

export const getReadinessReportRoute = createRoute({
  method: "get",
  path: "/api/v1/admin/readiness",
  operationId: "readiness.getReport",
  tags: ["Readiness"],
  security: authenticationSecurity,
  summary: "Get production readiness checks",
  responses: {
    200: jsonResponse(
      "Production readiness report",
      dataEnvelope(ReadinessReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const readinessRoutes = [getReadinessReportRoute] as const;
