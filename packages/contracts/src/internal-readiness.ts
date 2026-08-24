import { createRoute, z } from "@hono/zod-openapi";

import { dataEnvelope, jsonResponse } from "./common";

const dependencyId = z.enum([
  "configuration",
  "database",
  "migrations",
  "object_storage",
  "scheduled_operations",
  "valkey",
]);

export const InternalReadinessReportSchema = z
  .strictObject({
    status: z.enum(["ready", "unready"]),
    generatedAt: z.iso.datetime(),
    checks: z
      .array(
        z.strictObject({
          id: dependencyId,
          status: z.enum(["pass", "fail"]),
        }),
      )
      .min(1)
      .max(6),
  })
  .openapi("InternalReadinessReport");

const readinessResponse = dataEnvelope(InternalReadinessReportSchema);

export const getInternalReadinessRoute = createRoute({
  method: "get",
  path: "/api/v1/readyz",
  operationId: "health.getInternalReadiness",
  security: [],
  summary: "Get dependency-aware internal runtime readiness",
  tags: ["Health"],
  responses: {
    200: jsonResponse("Runtime is ready", readinessResponse),
    404: { description: "Not available outside the internal transport" },
    503: jsonResponse("Runtime is not ready", readinessResponse),
  },
});

export type InternalReadinessReport = z.infer<
  typeof InternalReadinessReportSchema
>;

export const internalReadinessRoutes = [getInternalReadinessRoute] as const;
