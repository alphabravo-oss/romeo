import type { ToolApprovalPolicy, ToolRiskLevel } from "@romeo/tools";

export type ToolConnectorType =
  | "built_in"
  | "openapi"
  | "mcp"
  | "webhook"
  | "browser"
  | "enterprise";
export type ToolVisibility = "private" | "workspace" | "org";
export type ToolOperationTestDisabledReason =
  | "auth_not_configured"
  | "base_url_missing"
  | "connector_disabled"
  | "external_execution_disabled"
  | "network_policy_missing"
  | "operation_disabled";

export interface ToolNetworkPolicy {
  mode: "deny_all" | "allow_hosts";
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
}

export interface AgentToolBinding {
  id: string;
  orgId: string;
  agentId: string;
  toolId: string;
  enabled: boolean;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  actorId: string;
  toolId: string;
  status: "blocked" | "approval_required" | "success" | "failure";
  riskLevel: string;
  approvalRequired: boolean;
  inputKeys: string[];
  outputKeys: string[];
  errorCode?: string;
  runId?: string;
  startedAt: string;
  completedAt: string;
}

export interface ToolConnector {
  id: string;
  orgId: string;
  type: ToolConnectorType;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  authConfig: Record<string, unknown>;
  networkPolicy: ToolNetworkPolicy;
  riskLevel: ToolRiskLevel;
  approvalPolicy: ToolApprovalPolicy;
  visibility: ToolVisibility;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolOperation {
  id: string;
  orgId: string;
  connectorId: string;
  operationId: string;
  method: string;
  path: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  approvalPolicy: ToolApprovalPolicy;
  enabled: boolean;
  createdAt: string;
}

export interface ToolOperationTestPreview {
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  riskLevel: ToolRiskLevel;
  approvalPolicy: ToolApprovalPolicy;
  readyForExecution: boolean;
  disabledReasons: ToolOperationTestDisabledReason[];
  executionPlan: {
    dispatch: "blocked" | "ready_for_worker";
    executionMode: "dry_run_only" | "external_worker";
    workerQueue: "external_tool_operations";
    approvalRequired: boolean;
    requiredBeforeDispatch: ToolOperationTestDisabledReason[];
    secretResolution: {
      required: boolean;
      configured: boolean;
      scheme?: string;
    };
    networkPolicy: {
      mode: ToolNetworkPolicy["mode"];
      allowedHostCount: number;
      allowPrivateNetwork: boolean;
    };
  };
  requestPreview: {
    parameterKeys: string[];
    bodyKeys: string[];
    declaredPathParameters: string[];
    declaredQueryParameters: string[];
    authConfigured: boolean;
    networkExecution: "disabled" | "worker_ready";
  };
}

export interface ToolOperationDispatchResult {
  job: {
    id: string;
    type: string;
    status: "completed" | "failed" | "queued" | "running";
  };
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  request: {
    parameterKeys: string[];
    bodyKeys: string[];
    host: string;
    authInjected: boolean;
  };
  response: {
    ok: boolean;
    status: number;
    contentType?: string;
    bodyBytes: number;
    truncated: boolean;
    schemaValidation: {
      status: "failed" | "not_applicable" | "passed" | "skipped";
      errorCode?: string;
    };
  };
}

export type ToolOperationDispatchPayloadStorage =
  | "external_worker_secret_store_required"
  | "managed_encrypted_object_store";

export interface ToolOperationDispatchPayloadStoreReference {
  contentType: "application/vnd.romeo.tool-dispatch-payload+json";
  driver: "object_store";
  encrypted: true;
  objectKey: string;
  schemaVersion: "romeo.tool-dispatch-payload.v1";
}

export type ToolOperationDispatchPayloadAuth =
  | {
      secretRef: string;
      type: "bearer";
    }
  | {
      apiKeyIn?: "header" | "query";
      apiKeyName?: string;
      secretRef: string;
      type: "api_key";
    }
  | {
      secretRef: string;
      type: "oauth2_client_credentials";
    };

export interface ToolOperationDispatchPayload {
  auth?: ToolOperationDispatchPayloadAuth;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  parameters?: Record<string, unknown>;
}

export type ToolOperationDispatchTransport =
  | {
      protocol: "http";
      requestBody: "raw_json";
    }
  | {
      protocol: "mcp_streamable_http";
      requestBody: "mcp_tools_call";
      mcpToolName: string;
      mcpProtocolVersion: string;
    };

export interface ToolOperationDispatchRequestResult {
  job: {
    id: string;
    type: string;
    status: "completed" | "failed" | "queued" | "running";
  };
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  workerQueue: "external_tool_operations";
  request: {
    parameterKeys: string[];
    bodyKeys: string[];
    host: string;
    payloadStorage: ToolOperationDispatchPayloadStorage;
  };
  approval: {
    required: boolean;
    approvalPolicy: ToolApprovalPolicy;
    riskLevel: ToolRiskLevel;
    approvalRequestId?: string;
  };
  idempotency?: {
    replayed: boolean;
  };
}

export interface ToolOperationDispatchRequestClaimResult {
  claimed: boolean;
  job?: {
    id: string;
    type: string;
    status: "completed" | "failed" | "queued" | "running";
  };
  connectorId?: string;
  operationId?: string;
  method?: string;
  pathTemplate?: string;
  workerQueue: "external_tool_operations";
  request?: {
    parameterKeys: string[];
    bodyKeys: string[];
    host: string;
    payloadStorage: ToolOperationDispatchPayloadStorage;
  };
  payloadStore?: ToolOperationDispatchPayloadStoreReference;
  lease?: {
    workerId: string;
    claimedAt: string;
    renewedAt: string;
    expiresAt: string;
    leaseSeconds: number;
    attempt: number;
  };
  authPolicy?: {
    oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
    oauthScopes?: string[];
    oauthTokenUrl?: string;
    type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
  };
  responseValidation?: {
    jsonSchemas: Record<string, Record<string, unknown>>;
  };
  transport?: ToolOperationDispatchTransport;
}

export interface ToolOperationDispatchRequestPayloadResult {
  job: {
    id: string;
    type: string;
    status: "completed" | "failed" | "queued" | "running";
  };
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  workerQueue: "external_tool_operations";
  request: {
    parameterKeys: string[];
    bodyKeys: string[];
    host: string;
    payloadStorage: ToolOperationDispatchPayloadStorage;
  };
  payload: ToolOperationDispatchPayload;
}

export interface ToolOperationDispatchReadbackResponse {
  ok: boolean;
  status: number;
  contentType?: string;
  bodyBytes: number;
  truncated: boolean;
  schemaValidation: {
    status: "failed" | "not_applicable" | "passed" | "skipped";
    errorCode?: string;
  };
}

export interface ToolOperationDispatchRequestReadbackResult {
  job: {
    id: string;
    type: string;
    status: "completed" | "failed" | "queued" | "running";
  };
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  workerQueue: "external_tool_operations";
  outcome: "cancelled" | "completed" | "failed";
  response?: ToolOperationDispatchReadbackResponse;
  errorCode?: string;
}

export type ToolOperationDispatchRequestExpiryReason =
  | "queued_timeout"
  | "running_lease_timeout";

export interface ToolOperationDispatchRequestExpiryResult {
  expired: number;
  workerQueue: "external_tool_operations";
  jobs: Array<{
    job: {
      id: string;
      type: string;
      status: "completed" | "failed" | "queued" | "running";
    };
    connectorId: string;
    operationId: string;
    method: string;
    pathTemplate: string;
    reasonCode: ToolOperationDispatchRequestExpiryReason;
  }>;
}

export interface ToolConnectorAuthCheck {
  connectorId: string;
  configured: boolean;
  available: boolean;
  secretRefScheme?: string;
  failureCode?: string;
  checkedAt: string;
}
