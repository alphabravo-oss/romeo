import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const nonNegativeInteger = z.number().int().nonnegative();

export const DataConnectorTypeSchema = z
  .enum([
    "local_import",
    "github",
    "s3",
    "website",
    "rss",
    "confluence",
    "jira",
    "notion",
    "linear",
    "slack",
  ])
  .openapi("DataConnectorType");

export const DataConnectorSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    knowledgeBaseId: id,
    type: DataConnectorTypeSchema,
    name: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    status: z.enum(["active", "disabled"]),
    syncIntervalMinutes: z.number().int().min(5).max(43_200).optional(),
    nextSyncAt: time.optional(),
    createdBy: id,
    createdAt: time,
    updatedAt: time,
    lastSyncAt: time.optional(),
  })
  .openapi("DataConnector");

export const DataConnectorSyncSchema = z
  .strictObject({
    id,
    orgId: id,
    workspaceId: id,
    knowledgeBaseId: id,
    connectorId: id,
    status: z.enum(["running", "completed", "failed"]),
    createdBy: id,
    itemCount: nonNegativeInteger,
    sourceIds: z.array(id),
    summary: z.record(z.string(), z.unknown()),
    errorCode: z.string().optional(),
    startedAt: time,
    completedAt: time.optional(),
  })
  .openapi("DataConnectorSync");

const DataConnectorCredentialSourceSchema = z.enum([
  "none",
  "deployment_secret",
  "connector_secret_ref",
  "delegated_oauth",
]);

const DataConnectorCatalogEntrySchema = z.strictObject({
  type: DataConnectorTypeSchema,
  displayName: z.string(),
  description: z.string(),
  implementationStatus: z.enum(["implemented", "planned"]),
  syncMode: z.enum(["inline_items", "managed_fetch"]),
  executionBoundary: z.enum(["api_ingest", "bounded_runtime_fetch"]),
  supportsScheduledSync: z.boolean(),
  supportsDelegatedOAuth: z.boolean(),
  credentialSources: z.array(DataConnectorCredentialSourceSchema),
  requiredConfigKeys: z.array(z.string()),
  optionalConfigKeys: z.array(z.string()),
  egress: z.strictObject({
    required: z.boolean(),
    allowlistSupported: z.boolean(),
    hostSource: z.enum(["none", "connector_url", "github_api", "s3_endpoint"]),
    privateNetworkDeniedByExecutor: z.boolean(),
  }),
  limits: z.strictObject({
    maxConfigItems: nonNegativeInteger.optional(),
    maxInlineItems: nonNegativeInteger.optional(),
    maxInlineItemBytes: nonNegativeInteger.optional(),
  }),
  securityControls: z.array(z.string()),
});

const ExecutionDriverSchema = z.enum([
  "disabled",
  "website-fetch",
  "github-fetch",
  "s3-fetch",
  "atlassian-fetch",
  "notion-fetch",
  "linear-fetch",
  "slack-fetch",
  "managed-fetch",
]);
const EgressPolicySchema = z.enum(["allow_public", "require_allowlist"]);
const SecretResolverDriverSchema = z.enum([
  "disabled",
  "env",
  "vault",
  "aws-sm",
  "gcp-sm",
  "azure-kv",
  "cloud",
]);
const FetchLimitsSchema = z.strictObject({
  maxBytes: nonNegativeInteger,
  retryAttempts: nonNegativeInteger,
  retryBackoffMs: nonNegativeInteger,
  timeoutMs: nonNegativeInteger,
});
const SecretResolverPostureSchema = z.strictObject({
  driver: SecretResolverDriverSchema,
  managedSecretConfigured: z.boolean(),
  externalValueResolverConfigured: z.boolean(),
});

export const DataConnectorCatalogReportSchema = z
  .strictObject({
    executionDriver: ExecutionDriverSchema,
    egressPolicy: EgressPolicySchema,
    allowedHostRuleCount: nonNegativeInteger,
    fetchLimits: FetchLimitsSchema,
    secretResolver: SecretResolverPostureSchema,
    connectors: z.array(
      DataConnectorCatalogEntrySchema.extend({
        runtime: z.strictObject({
          syncEnabled: z.boolean(),
          blockedReasons: z.array(z.string()),
          warnings: z.array(z.string()),
          credentialPosture: z.record(
            DataConnectorCredentialSourceSchema,
            z.boolean(),
          ),
        }),
      }),
    ),
  })
  .openapi("DataConnectorCatalogReport");

const liveEvidenceChecks = z.strictObject({
  managed_connector_sync_exercised: z.boolean(),
  worker_cni_egress_enforced: z.boolean(),
  dns_private_address_denied: z.boolean(),
  secret_ref_resolution_verified: z.boolean(),
  worker_crash_retry_or_requeue_verified: z.boolean(),
  sync_log_redaction: z.boolean(),
  sanitized_readback_verified: z.boolean(),
});

const redactionBooleans = z.strictObject({
  rawAllowedHostsReturned: z.boolean(),
  rawConnectorConfigReturned: z.boolean(),
  rawConnectorContentReturned: z.boolean(),
  rawEndpointUrlsReturned: z.boolean(),
  rawEvidencePathsReturned: z.boolean(),
  rawSecretRefsReturned: z.boolean(),
  secretValuesReturned: z.boolean(),
  tokenValuesReturned: z.boolean(),
});

export const DataConnectorPostureReportSchema = z
  .strictObject({
    schema: z.literal("romeo.data-connector-posture.v1"),
    generatedAt: time,
    orgId: id,
    status: z.enum(["attention_required", "ready"]),
    runtime: z.strictObject({
      executionDriver: ExecutionDriverSchema,
      egressPolicy: EgressPolicySchema,
      managedFetchEnabled: z.boolean(),
      allowedHostRuleCount: nonNegativeInteger,
      fetchLimits: FetchLimitsSchema,
      secretResolver: SecretResolverPostureSchema,
      credentialPosture: z.strictObject({
        delegatedOAuthGithubConfigured: z.boolean(),
        githubDeploymentTokenConfigured: z.boolean(),
        s3DeploymentCredentialsConfigured: z.boolean(),
        s3EndpointConfigured: z.boolean(),
      }),
    }),
    deployment: z.strictObject({
      liveEvidencePathConfigured: z.boolean(),
      networkPolicyConfigured: z.boolean(),
      workerEnabled: z.boolean(),
    }),
    connectors: z.strictObject({
      active: nonNegativeInteger,
      disabled: nonNegativeInteger,
      due: nonNegativeInteger,
      managed: nonNegativeInteger,
      scheduled: nonNegativeInteger,
      total: nonNegativeInteger,
      byType: z.record(DataConnectorTypeSchema, nonNegativeInteger),
    }),
    syncs: z.strictObject({
      completed: nonNegativeInteger,
      failed: nonNegativeInteger,
      latestCompletedAt: z.union([time, z.null()]),
      latestFailedAt: z.union([time, z.null()]),
      running: nonNegativeInteger,
      total: nonNegativeInteger,
    }),
    liveEvidence: z.strictObject({
      configured: z.boolean(),
      source: z.enum(["configured_file", "not_configured"]),
      status: z.enum(["failed", "invalid", "not_configured", "satisfied"]),
      schemaVersion: z
        .literal("romeo.data-connector-live-evidence.v1")
        .optional(),
      evidenceStatus: z
        .enum(["failed", "passed", "planned", "unknown"])
        .optional(),
      mode: z.enum(["dry-run", "live", "unknown"]).optional(),
      deployment: z
        .enum(["compose", "kubernetes", "target", "unknown"])
        .optional(),
      generatedAt: time.optional(),
      checks: liveEvidenceChecks,
      failureCodes: z.array(z.string()),
      invalidReason: z
        .enum(["invalid_json", "read_failed", "schema_mismatch"])
        .optional(),
      summary: z.strictObject({
        delegatedOAuthConnectorCount: nonNegativeInteger,
        deniedPrivateTargetCount: nonNegativeInteger,
        failedSyncCount: nonNegativeInteger,
        managedConnectorTypeCount: nonNegativeInteger,
        podLogScanCount: nonNegativeInteger,
        requeuedSyncCount: nonNegativeInteger,
        secretRefConnectorCount: nonNegativeInteger,
        successfulSyncCount: nonNegativeInteger,
        syncAttemptCount: nonNegativeInteger,
        workerLogScanCount: nonNegativeInteger,
      }),
      redaction: redactionBooleans.extend({ rawLogLinesReturned: z.boolean() }),
    }),
    redaction: redactionBooleans.extend({
      evidenceFileBodiesReturned: z.literal(false),
    }),
    warnings: z.array(
      z.enum([
        "data_connector_driver_disabled",
        "data_connector_failed_syncs_present",
        "data_connector_live_evidence_invalid",
        "data_connector_live_evidence_required",
        "data_connector_network_policy_not_configured",
        "data_connector_scheduled_syncs_without_worker",
        "data_connector_worker_not_enabled",
      ]),
    ),
  })
  .openapi("DataConnectorPostureReport");

export const CreateDataConnectorSchema = z
  .strictObject({
    workspaceId: id,
    knowledgeBaseId: id,
    type: DataConnectorTypeSchema,
    name: z.string().trim().min(1),
    syncIntervalMinutes: z.number().int().min(5).max(43_200).optional(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .openapi("CreateDataConnectorRequest");

export const SyncDataConnectorSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          fileName: z.string().min(1),
          mimeType: z.string().min(1),
          content: z.string().min(1).max(200_000),
          sizeBytes: z.number().int().positive().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .openapi("SyncDataConnectorRequest");

const meta = { tags: ["Data connectors"], security: authenticationSecurity };
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const connectorPath = z.strictObject({ connectorId: id });

export const getDataConnectorPostureRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/admin/data-connectors/posture",
  operationId: "dataConnectors.getPosture",
  summary: "Get posture",
  responses: {
    200: jsonResponse(
      "Data connector posture",
      dataEnvelope(DataConnectorPostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const listDataConnectorsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/data-connectors",
  operationId: "dataConnectors.list",
  summary: "List",
  request: { query: z.strictObject({ workspaceId: id.optional() }) },
  responses: {
    200: jsonResponse(
      "Data connectors",
      dataEnvelope(z.array(DataConnectorSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const createDataConnectorRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/data-connectors",
  operationId: "dataConnectors.create",
  summary: "Create",
  request: { body: body(CreateDataConnectorSchema) },
  responses: {
    201: jsonResponse("Data connector", dataEnvelope(DataConnectorSchema)),
    ...standardErrorResponses,
  },
});
export const getDataConnectorCatalogRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/data-connectors/catalog",
  operationId: "dataConnectors.getCatalog",
  summary: "Get catalog",
  responses: {
    200: jsonResponse(
      "Data connector catalog",
      dataEnvelope(DataConnectorCatalogReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const syncDataConnectorRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/data-connectors/{connectorId}/sync",
  operationId: "dataConnectors.sync",
  summary: "Sync",
  request: { params: connectorPath, body: body(SyncDataConnectorSchema) },
  responses: {
    202: jsonResponse(
      "Data connector sync",
      dataEnvelope(DataConnectorSyncSchema),
    ),
    ...standardErrorResponses,
  },
});
export const listDataConnectorSyncsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/data-connectors/{connectorId}/syncs",
  operationId: "dataConnectors.listSyncs",
  summary: "List syncs",
  request: { params: connectorPath },
  responses: {
    200: jsonResponse(
      "Data connector syncs",
      dataEnvelope(z.array(DataConnectorSyncSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const dataConnectorRoutes = [
  getDataConnectorPostureRoute,
  listDataConnectorsRoute,
  createDataConnectorRoute,
  getDataConnectorCatalogRoute,
  syncDataConnectorRoute,
  listDataConnectorSyncsRoute,
] as const;
