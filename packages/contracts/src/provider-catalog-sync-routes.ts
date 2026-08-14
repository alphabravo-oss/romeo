import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { ProviderCatalogSyncJobSchema } from "./provider-catalog-schemas";

const identifier = z.string().trim().min(1).max(300);
const metadata = { tags: ["Providers"], security: authenticationSecurity };
const mutationErrors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;

export const runProviderCatalogSyncJobRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/providers/{providerId}/sync-jobs/{jobId}/run",
  operationId: "providers.syncJobs.run",
  summary: "Run one provider catalog sync job tick",
  request: {
    params: z.strictObject({ jobId: identifier, providerId: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Catalog sync job",
      dataEnvelope(ProviderCatalogSyncJobSchema),
    ),
    ...mutationErrors,
  },
});

export const getProviderCatalogSyncJobRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/providers/{providerId}/sync-jobs/{jobId}",
  operationId: "providers.syncJobs.get",
  summary: "Read a provider catalog sync job",
  request: {
    params: z.strictObject({ jobId: identifier, providerId: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Catalog sync job",
      dataEnvelope(ProviderCatalogSyncJobSchema),
    ),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});
