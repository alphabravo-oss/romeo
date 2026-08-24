import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const deleteTableExportRoute = createRoute({
  security: authenticationSecurity,
  tags: ["Administration"],
  method: "delete",
  path: "/api/v1/admin/table-exports/{jobId}",
  operationId: "tableExports.delete",
  summary: "Delete an owned table-export artifact and expire the job",
  request: {
    params: z.strictObject({ jobId: z.string().trim().min(1).max(300) }),
  },
  responses: {
    200: jsonResponse(
      "Deleted table export",
      dataEnvelope(z.strictObject({ deleted: z.literal(true) })),
    ),
    ...standardErrorResponses,
  },
});
