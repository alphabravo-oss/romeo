import { z } from "@hono/zod-openapi";

export const ToolConnectorTypeSchema = z.enum([
  "built_in",
  "openapi",
  "mcp",
  "webhook",
  "browser",
  "enterprise",
]);

const catalogEntry = z.strictObject({
  type: ToolConnectorTypeSchema,
  displayName: z.string(),
  description: z.string(),
  implementationStatus: z.enum(["implemented", "planned", "separate_api"]),
  creationMode: z.enum([
    "built_in_registry",
    "mcp_manifest",
    "not_available",
    "openapi_import",
    "webhook_registration",
    "workflow_browser_automation",
  ]),
  executionBoundary: z.enum([
    "bounded_in_process",
    "external_worker_dispatch",
    "not_available",
    "workflow_worker_bridge",
  ]),
  operationDiscovery: z.enum([
    "mcp_manifest",
    "openapi_import",
    "planned",
    "static_registry",
    "webhook_registration",
  ]),
  supportsAuthConfig: z.boolean(),
  supportsNetworkPolicy: z.boolean(),
  supportsModelToolInjection: z.boolean(),
  credentialSources: z.array(
    z.enum(["managed_secret_ref", "none", "oauth2_client_credentials"]),
  ),
  requiredScopes: z.array(z.string()),
  securityControls: z.array(z.string()),
  blockedReasons: z.array(z.string()),
});

export const ToolConnectorCatalogReportSchema = z
  .strictObject({
    schemaVersion: z.literal("romeo.tool-connector-catalog.v1"),
    entries: z.array(catalogEntry),
    redaction: z.strictObject({
      rawConnectorConfigsReturned: z.literal(false),
      rawEndpointUrlsReturned: z.literal(false),
      rawSecretRefsReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
    }),
  })
  .openapi("ToolConnectorCatalogReport");
