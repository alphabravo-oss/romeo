import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  agentPath,
  managedModelIdentifier,
  ManagedModelGrantSchema,
  ShareManagedModelSchema,
} from "./managed-model-schemas";

const metadata = {
  tags: ["Managed Models"],
  security: authenticationSecurity,
};
const errors = {
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  500: standardErrorResponses[500],
} as const;
const mutationErrors = {
  400: standardErrorResponses[400],
  ...errors,
  409: standardErrorResponses[409],
} as const;

export const listManagedModelGrantsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/shares",
  operationId: "managedModels.listGrants",
  summary: "List managed-model access grants",
  request: { params: agentPath },
  responses: {
    200: jsonResponse(
      "Managed-model access grants",
      dataEnvelope(z.array(ManagedModelGrantSchema)),
    ),
    ...errors,
  },
});

export const shareManagedModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/{agentId}/shares",
  operationId: "managedModels.share",
  summary: "Grant managed-model access",
  description:
    "Idempotently grants the selected permissions to one tenant principal.",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: { "application/json": { schema: ShareManagedModelSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Managed-model access grants",
      dataEnvelope(z.array(ManagedModelGrantSchema)),
    ),
    ...mutationErrors,
  },
});

export const revokeManagedModelGrantRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/agents/{agentId}/shares/{grantId}",
  operationId: "managedModels.revokeGrant",
  summary: "Revoke a managed-model access grant",
  request: {
    params: z.strictObject({
      agentId: managedModelIdentifier,
      grantId: managedModelIdentifier,
    }),
  },
  responses: {
    200: jsonResponse(
      "Revoked managed-model access grant",
      dataEnvelope(ManagedModelGrantSchema),
    ),
    ...mutationErrors,
  },
});
