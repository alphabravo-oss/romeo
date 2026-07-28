import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ToolConnectorCatalogReportSchema,
  ToolConnectorTypeSchema,
} from "./tool-connector-catalog-schema";

export { ToolConnectorCatalogReportSchema } from "./tool-connector-catalog-schema";

const id = z.string().min(1).max(200);
const tags = ["Tool connectors"];
const risk = z.enum(["low", "medium", "high", "critical"]);
const approval = z.enum([
  "never",
  "write_operations",
  "external_side_effects",
  "always",
  "admin_only",
]);
const connectorType = ToolConnectorTypeSchema;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const ToolConnectorSchema = z
  .strictObject({
    id,
    orgId: id,
    type: connectorType,
    name: z.string(),
    description: z.string(),
    schema: z.record(z.string(), z.unknown()),
    authConfig: z.record(z.string(), z.unknown()),
    networkPolicy: z.strictObject({
      mode: z.enum(["deny_all", "allow_hosts"]),
      allowedHosts: z.array(z.string()),
      allowPrivateNetwork: z.boolean(),
    }),
    riskLevel: risk,
    approvalPolicy: approval,
    visibility: z.enum(["private", "workspace", "org"]),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("ToolConnector");
export const ToolOperationSchema = z
  .strictObject({
    id,
    orgId: id,
    connectorId: id,
    operationId: id,
    method: z.string(),
    path: z.string(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    riskLevel: risk,
    approvalPolicy: approval,
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .openapi("ToolOperation");
export const ImportedToolConnectorSchema = z
  .strictObject({
    connector: ToolConnectorSchema,
    operations: z.array(ToolOperationSchema),
  })
  .openapi("ImportedToolConnector");
export const ToolConnectorAuthCheckSchema = z
  .strictObject({
    connectorId: id,
    configured: z.boolean(),
    available: z.boolean(),
    secretRefScheme: z.string().optional(),
    failureCode: z.string().optional(),
    checkedAt: z.string().datetime(),
  })
  .openapi("ToolConnectorAuthCheck");
const disabledReason = z.enum([
  "auth_not_configured",
  "base_url_missing",
  "connector_disabled",
  "external_execution_disabled",
  "network_policy_missing",
  "operation_disabled",
]);
export const ToolOperationTestPreviewSchema = z
  .strictObject({
    connectorId: id,
    operationId: id,
    method: z.string(),
    pathTemplate: z.string(),
    riskLevel: risk,
    approvalPolicy: approval,
    readyForExecution: z.boolean(),
    disabledReasons: z.array(disabledReason),
    executionPlan: z.strictObject({
      dispatch: z.enum(["blocked", "ready_for_worker"]),
      executionMode: z.enum(["dry_run_only", "external_worker"]),
      workerQueue: z.literal("external_tool_operations"),
      approvalRequired: z.boolean(),
      requiredBeforeDispatch: z.array(disabledReason),
      secretResolution: z.strictObject({
        required: z.boolean(),
        configured: z.boolean(),
        scheme: z.string().optional(),
      }),
      networkPolicy: z.strictObject({
        mode: z.enum(["deny_all", "allow_hosts"]),
        allowedHostCount: z.number().int().nonnegative(),
        allowPrivateNetwork: z.boolean(),
      }),
    }),
    requestPreview: z.strictObject({
      parameterKeys: z.array(z.string()),
      bodyKeys: z.array(z.string()),
      declaredPathParameters: z.array(z.string()),
      declaredQueryParameters: z.array(z.string()),
      authConfigured: z.boolean(),
      networkExecution: z.enum(["disabled", "worker_ready"]),
    }),
  })
  .openapi("ToolOperationTestPreview");
export const ToolOperationDispatchResultSchema = z
  .strictObject({
    job: z.strictObject({
      id,
      type: z.string(),
      status: z.enum(["completed", "failed", "queued", "running"]),
    }),
    connectorId: id,
    operationId: id,
    method: z.string(),
    pathTemplate: z.string(),
    request: z.strictObject({
      parameterKeys: z.array(z.string()),
      bodyKeys: z.array(z.string()),
      host: z.string(),
      authInjected: z.boolean(),
    }),
    response: z.strictObject({
      ok: z.boolean(),
      status: z.number().int().min(100).max(599),
      contentType: z.string().optional(),
      bodyBytes: z.number().int().nonnegative(),
      truncated: z.boolean(),
      schemaValidation: z.strictObject({
        status: z.enum(["failed", "not_applicable", "passed", "skipped"]),
        errorCode: z.string().optional(),
      }),
    }),
  })
  .openapi("ToolOperationDispatchResult");
export const TestToolOperationRequestSchema = z
  .strictObject({
    parameters: z.record(z.string(), z.unknown()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("TestToolOperationRequest");
export const DispatchToolOperationRequestSchema =
  TestToolOperationRequestSchema.extend({
    approved: z.boolean().optional(),
    approvalRequestId: id.optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  }).openapi("DispatchToolOperationRequest");

export const ImportOpenApiToolRequestSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    spec: z.record(z.string(), z.unknown()),
    riskLevel: risk.optional(),
    approvalPolicy: approval.optional(),
  })
  .openapi("ImportOpenApiToolRequest");
export const CreateWebhookToolRequestSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    url: z.string().url().max(1000),
    description: z.string().min(1).max(500).optional(),
    operationName: z.string().min(1).max(120).optional(),
    bodySchema: z.record(z.string(), z.unknown()).optional(),
    riskLevel: risk.optional(),
    approvalPolicy: approval.optional(),
  })
  .openapi("CreateWebhookToolRequest");
const mcpEntry = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.:/-]+$/u),
  description: z.string().min(1).max(500).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  riskLevel: risk.optional(),
  approvalPolicy: approval.optional(),
});
export const CreateMcpToolRequestSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    serverUrl: z.string().url().max(1000),
    description: z.string().min(1).max(500).optional(),
    protocolVersion: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    tools: z.array(mcpEntry).min(1).max(100),
    riskLevel: risk.optional(),
    approvalPolicy: approval.optional(),
  })
  .openapi("CreateMcpToolRequest");
export const UpdateToolConnectorAuthRequestSchema = z
  .strictObject({
    type: z.enum(["none", "api_key", "bearer", "oauth2_client_credentials"]),
    secretRef: z.string().min(1).optional(),
    apiKeyIn: z.enum(["header", "query"]).optional(),
    apiKeyName: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.-]+$/u)
      .optional(),
    oauthTokenUrl: z.string().url().optional(),
    oauthScopes: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9_:./-]+$/u),
      )
      .max(20)
      .optional(),
    oauthClientAuthMethod: z
      .enum(["client_secret_basic", "client_secret_post"])
      .optional(),
  })
  .refine(
    (value) => value.type === "none" || value.secretRef !== undefined,
    "Connector auth requires a secret reference.",
  )
  .openapi("UpdateToolConnectorAuthRequest");
export const UpdateToolConnectorNetworkPolicyRequestSchema = z
  .strictObject({
    mode: z.enum(["deny_all", "allow_hosts"]),
    allowedHosts: z.array(z.string().min(1).max(253)).max(25).default([]),
    allowPrivateNetwork: z.boolean().default(false),
  })
  .refine(
    (value) => value.mode === "deny_all" || value.allowedHosts.length > 0,
    "Host allowlist requires at least one host.",
  )
  .openapi("UpdateToolConnectorNetworkPolicyRequest");
const connectorParams = z.strictObject({ connectorId: id });
const operationParams = z.strictObject({ connectorId: id, operationId: id });
const response = jsonResponse(
  "Tool connector",
  dataEnvelope(ToolConnectorSchema),
);
export const listToolConnectorsRoute = createRoute({
  method: "get",
  path: "/api/v1/tool-connectors",
  operationId: "toolConnectors.list",
  tags,
  summary: "List tool connectors",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Tool connectors",
      dataEnvelope(z.array(ToolConnectorSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const getToolConnectorCatalogRoute = createRoute({
  method: "get",
  path: "/api/v1/tool-connectors/catalog",
  operationId: "toolConnectors.getCatalog",
  tags,
  summary: "Get connector capability catalog",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Tool connector catalog",
      dataEnvelope(ToolConnectorCatalogReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const updateToolConnectorRoute = createRoute({
  method: "patch",
  path: "/api/v1/tool-connectors/{connectorId}",
  operationId: "toolConnectors.update",
  tags,
  summary: "Update connector activation",
  security: authenticationSecurity,
  request: {
    params: connectorParams,
    body: body(
      z
        .strictObject({ enabled: z.boolean() })
        .openapi("UpdateToolConnectorRequest"),
    ),
  },
  responses: { 200: response, ...standardErrorResponses },
});
export const importOpenApiToolRoute = createRoute({
  method: "post",
  path: "/api/v1/tools/openapi",
  operationId: "toolConnectors.importOpenApi",
  tags,
  summary: "Import an OpenAPI connector",
  security: authenticationSecurity,
  request: { body: body(ImportOpenApiToolRequestSchema) },
  responses: {
    201: jsonResponse(
      "Imported connector",
      dataEnvelope(ImportedToolConnectorSchema),
    ),
    ...standardErrorResponses,
  },
});
export const createWebhookToolRoute = createRoute({
  method: "post",
  path: "/api/v1/tools/webhook",
  operationId: "toolConnectors.createWebhook",
  tags,
  summary: "Create a webhook connector",
  security: authenticationSecurity,
  request: { body: body(CreateWebhookToolRequestSchema) },
  responses: {
    201: jsonResponse(
      "Webhook connector",
      dataEnvelope(ImportedToolConnectorSchema),
    ),
    ...standardErrorResponses,
  },
});
export const createMcpToolRoute = createRoute({
  method: "post",
  path: "/api/v1/tools/mcp",
  operationId: "toolConnectors.createMcp",
  tags,
  summary: "Create an MCP connector",
  security: authenticationSecurity,
  request: { body: body(CreateMcpToolRequestSchema) },
  responses: {
    201: jsonResponse(
      "MCP connector",
      dataEnvelope(ImportedToolConnectorSchema),
    ),
    ...standardErrorResponses,
  },
});
export const updateToolConnectorAuthRoute = createRoute({
  method: "patch",
  path: "/api/v1/tool-connectors/{connectorId}/auth",
  operationId: "toolConnectors.updateAuth",
  tags,
  summary: "Update connector authentication",
  security: authenticationSecurity,
  request: {
    params: connectorParams,
    body: body(UpdateToolConnectorAuthRequestSchema),
  },
  responses: { 200: response, ...standardErrorResponses },
});
export const checkToolConnectorAuthRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-connectors/{connectorId}/auth/check",
  operationId: "toolConnectors.checkAuth",
  tags,
  summary: "Check connector credential availability",
  security: authenticationSecurity,
  request: { params: connectorParams },
  responses: {
    200: jsonResponse("Auth check", dataEnvelope(ToolConnectorAuthCheckSchema)),
    ...standardErrorResponses,
  },
});
export const updateToolConnectorNetworkPolicyRoute = createRoute({
  method: "patch",
  path: "/api/v1/tool-connectors/{connectorId}/network-policy",
  operationId: "toolConnectors.updateNetworkPolicy",
  tags,
  summary: "Update connector network policy",
  security: authenticationSecurity,
  request: {
    params: connectorParams,
    body: body(UpdateToolConnectorNetworkPolicyRequestSchema),
  },
  responses: { 200: response, ...standardErrorResponses },
});
export const listToolOperationsRoute = createRoute({
  method: "get",
  path: "/api/v1/tool-connectors/{connectorId}/operations",
  operationId: "toolConnectors.listOperations",
  tags,
  summary: "List connector operations",
  security: authenticationSecurity,
  request: { params: connectorParams },
  responses: {
    200: jsonResponse(
      "Tool operations",
      dataEnvelope(z.array(ToolOperationSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const updateToolOperationRoute = createRoute({
  method: "patch",
  path: "/api/v1/tool-connectors/{connectorId}/operations/{operationId}",
  operationId: "toolConnectors.updateOperation",
  tags,
  summary: "Update operation activation",
  security: authenticationSecurity,
  request: {
    params: operationParams,
    body: body(
      z
        .strictObject({ enabled: z.boolean() })
        .openapi("UpdateToolOperationRequest"),
    ),
  },
  responses: {
    200: jsonResponse("Tool operation", dataEnvelope(ToolOperationSchema)),
    ...standardErrorResponses,
  },
});
export const testToolOperationRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/test",
  operationId: "toolConnectors.testOperation",
  tags,
  summary: "Dry-run a connector operation",
  security: authenticationSecurity,
  request: {
    params: operationParams,
    body: body(TestToolOperationRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Operation preview",
      dataEnvelope(ToolOperationTestPreviewSchema),
    ),
    ...standardErrorResponses,
  },
});
export const dispatchToolOperationRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch",
  operationId: "toolConnectors.dispatchOperation",
  tags,
  summary: "Dispatch a governed connector operation",
  security: authenticationSecurity,
  request: {
    params: operationParams,
    body: body(DispatchToolOperationRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Operation dispatch result",
      dataEnvelope(ToolOperationDispatchResultSchema),
    ),
    ...standardErrorResponses,
  },
});

export const toolConnectorRoutes = [
  listToolConnectorsRoute,
  getToolConnectorCatalogRoute,
  updateToolConnectorRoute,
  importOpenApiToolRoute,
  createWebhookToolRoute,
  createMcpToolRoute,
  updateToolConnectorAuthRoute,
  checkToolConnectorAuthRoute,
  updateToolConnectorNetworkPolicyRoute,
  listToolOperationsRoute,
  updateToolOperationRoute,
  testToolOperationRoute,
  dispatchToolOperationRoute,
] as const;
