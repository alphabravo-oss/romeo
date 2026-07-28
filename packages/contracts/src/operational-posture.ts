import { createRoute } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { GaEvidencePostureReportSchema } from "./ga-evidence-posture";
import { PostgresOperationalPostureReportSchema } from "./postgres-operational-posture";

export {
  GaEvidencePostureGateEvidenceSchema,
  GaEvidencePostureGateSchema,
} from "./ga-evidence-posture-base";
export { GaEvidencePostureReportSchema } from "./ga-evidence-posture";
export { PostgresOperationalPostureReportSchema } from "./postgres-operational-posture";

const metadata = {
  tags: ["Operational posture"],
  security: authenticationSecurity,
};

export const getGaEvidencePostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/ga/evidence-posture",
  operationId: "operationalPosture.getGaEvidence",
  summary: "Get sanitized GA evidence posture",
  responses: {
    200: jsonResponse(
      "GA evidence posture",
      dataEnvelope(GaEvidencePostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});

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

export const operationalPostureRoutes = [
  getGaEvidencePostureRoute,
  getPostgresOperationalPostureRoute,
] as const;
