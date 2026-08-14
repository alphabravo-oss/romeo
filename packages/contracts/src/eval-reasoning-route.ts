import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { EvalReasoningComparisonSchema } from "./eval-reasoning";

export const getEvalReasoningComparisonRoute = createRoute({
  tags: ["Evals"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/eval-suites/{suiteId}/reasoning-comparison",
  operationId: "evals.getReasoningComparison",
  summary: "Compare reasoning-policy eval runs",
  request: {
    params: z.strictObject({ suiteId: z.string().trim().min(1).max(300) }),
  },
  responses: {
    200: jsonResponse(
      "Reasoning-policy eval comparison",
      dataEnvelope(EvalReasoningComparisonSchema),
    ),
    ...standardErrorResponses,
  },
});
