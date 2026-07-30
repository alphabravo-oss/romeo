import { createRoute } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  agentPath,
  ManagedModelReadinessQuerySchema,
  readinessResponse,
} from "./managed-model-schemas";

export const getManagedModelReadinessRoute = createRoute({
  tags: ["Managed Models"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/agents/{agentId}/readiness",
  operationId: "managedModels.getReadiness",
  summary: "Evaluate effective access and dependency readiness",
  description:
    "Evaluates whether the current caller, or an administrator-selected principal, can run the published assistant with its model, provider, knowledge, tools, and voice dependencies.",
  request: {
    params: agentPath,
    query: ManagedModelReadinessQuerySchema,
  },
  responses: {
    200: jsonResponse("Managed-model readiness", readinessResponse),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});
