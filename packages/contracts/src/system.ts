import { createRoute, z } from "@hono/zod-openapi";

import { dataEnvelope, jsonResponse } from "./common";

export const HealthStatusSchema = z
  .strictObject({
    status: z.literal("ok"),
    service: z.literal("romeo-api"),
    version: z.string(),
    requestId: z.string(),
  })
  .openapi("HealthStatus");

export const HealthResponseSchema =
  dataEnvelope(HealthStatusSchema).openapi("HealthResponse");

export const getHealthRoute = createRoute({
  method: "get",
  path: "/api/v1/health",
  operationId: "system.getHealth",
  tags: ["System"],
  summary: "Check API readiness",
  description:
    "Returns the API process readiness state and the request correlation identifier.",
  security: [],
  responses: {
    200: jsonResponse("API health status", HealthResponseSchema),
  },
});
