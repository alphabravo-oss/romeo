import { createRoute } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { PostgresOperationalPostureReportSchema } from "./postgres-operational-posture";
import { RuntimeKeyRotationPostureReportSchema } from "./runtime-key-rotation-posture";

export { PostgresOperationalPostureReportSchema } from "./postgres-operational-posture";
export { RuntimeKeyRotationPostureReportSchema } from "./runtime-key-rotation-posture";

const metadata = {
  tags: ["Operational posture"],
  security: authenticationSecurity,
};

export const getPostgresOperationalPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/postgres/operational-posture",
  operationId: "operationalPosture.getPostgres",
  summary: "Get sanitized Postgres operational posture",
  responses: {
    200: jsonResponse(
      "Postgres operational posture",
      dataEnvelope(PostgresOperationalPostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const getRuntimeKeyRotationPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/runtime-key-rotation/posture",
  operationId: "operationalPosture.getRuntimeKeyRotation",
  summary: "Get global runtime key-rotation usage posture",
  responses: {
    200: jsonResponse(
      "Runtime key-rotation posture",
      dataEnvelope(RuntimeKeyRotationPostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const operationalPostureRoutes = [
  getPostgresOperationalPostureRoute,
  getRuntimeKeyRotationPostureRoute,
] as const;
