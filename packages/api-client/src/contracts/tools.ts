export type ToolRiskLevel = "critical" | "high" | "low" | "medium";
export type ToolApprovalPolicy =
  | "admin_only"
  | "always"
  | "external_side_effects"
  | "never"
  | "write_operations";
export type ToolConnectorType =
  | "browser"
  | "built_in"
  | "enterprise"
  | "mcp"
  | "openapi"
  | "webhook";
export type ToolConnectorImplementationStatus =
  | "implemented"
  | "planned"
  | "separate_api";
export type ToolConnectorCreationMode =
  | "built_in_registry"
  | "mcp_manifest"
  | "not_available"
  | "openapi_import"
  | "webhook_registration"
  | "workflow_browser_automation";
export type ToolConnectorExecutionBoundary =
  | "bounded_in_process"
  | "external_worker_dispatch"
  | "not_available"
  | "workflow_worker_bridge";
export type ToolConnectorOperationDiscovery =
  | "mcp_manifest"
  | "openapi_import"
  | "planned"
  | "static_registry"
  | "webhook_registration";
export type ToolConnectorCredentialSource =
  | "managed_secret_ref"
  | "none"
  | "oauth2_client_credentials";
export type ToolVisibility = "org" | "private" | "workspace";
export type ToolOperationTestDisabledReason =
  | "auth_not_configured"
  | "base_url_missing"
  | "connector_disabled"
  | "external_execution_disabled"
  | "network_policy_missing"
  | "operation_disabled";

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  approvalPolicy: ToolApprovalPolicy;
  requiredScopes: string[];
  timeoutMs: number;
}

export interface AgentToolSummary extends ToolSummary {
  agentId: string;
  bound: boolean;
  enabled: boolean;
  approvalRequired: boolean;
  hasAccess: boolean;
}

export interface ToolCallRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  actorId: string;
  toolId: string;
  status: "approval_required" | "blocked" | "failure" | "success";
  riskLevel: ToolRiskLevel;
  approvalRequired: boolean;
  inputKeys: string[];
  outputKeys: string[];
  errorCode?: string;
  runId?: string;
  startedAt: string;
  completedAt: string;
}

export interface ToolApprovalDecision {
  approvedAt?: string;
  approvalRequestId: string;
  cancelledAt?: string;
  decidedAt: string;
  rejectedAt?: string;
  status: "approved" | "cancelled" | "rejected";
  toolId: string;
  agentId?: string;
  runId?: string;
  workspaceId?: string;
}

export interface ToolApprovalRequest {
  id: string;
  orgId: string;
  approvalRequestId: string;
  approvalRequired: true;
  actorId: string;
  availableActions: Array<"approve" | "cancel" | "reject">;
  completedAt: string;
  errorCode?: string;
  expiresAt: string;
  inputKeys: string[];
  outputKeys: string[];
  requestedAt: string;
  riskLevel: string;
  source: "operation_dispatch" | "tool_call";
  startedAt: string;
  status: "approval_required";
  toolId: string;
  agentId?: string;
  context?: {
    bodyKeys: string[];
    connectorId: string;
    method: string;
    operationId: string;
    parameterKeys: string[];
    path: string;
    agentId?: string;
    runId?: string;
    workspaceId?: string;
  };
  runId?: string;
  tool: {
    id: string;
    approvalPolicy: string;
    description: string;
    kind: "built_in" | "imported_operation" | "unknown";
    name: string;
    riskLevel: string;
    connectorId?: string;
    method?: string;
    operationId?: string;
    path?: string;
  };
  workspaceId?: string;
}

export interface ToolNetworkPolicy {
  mode: "allow_hosts" | "deny_all";
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
}

export interface ToolConnectorCatalogEntry {
  type: ToolConnectorType;
  displayName: string;
  description: string;
  implementationStatus: ToolConnectorImplementationStatus;
  creationMode: ToolConnectorCreationMode;
  executionBoundary: ToolConnectorExecutionBoundary;
  operationDiscovery: ToolConnectorOperationDiscovery;
  supportsAuthConfig: boolean;
  supportsNetworkPolicy: boolean;
  supportsModelToolInjection: boolean;
  credentialSources: ToolConnectorCredentialSource[];
  requiredScopes: string[];
  securityControls: string[];
  blockedReasons: string[];
}

export interface ToolConnectorCatalogReport {
  schemaVersion: "romeo.tool-connector-catalog.v1";
  entries: ToolConnectorCatalogEntry[];
  redaction: {
    rawConnectorConfigsReturned: false;
    rawEndpointUrlsReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
  };
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

export type ToolDispatchPostureWarning =
  | "tool_dispatch_dead_letters_present"
  | "tool_dispatch_execution_disabled"
  | "tool_dispatch_failed_jobs_present"
  | "tool_dispatch_live_evidence_invalid"
  | "tool_dispatch_live_evidence_required"
  | "tool_dispatch_managed_payload_store_disabled"
  | "tool_dispatch_network_policy_not_configured"
  | "tool_dispatch_stale_jobs_present"
  | "tool_dispatch_worker_not_enabled";

export interface ToolDispatchPostureReport {
  schema: "romeo.tool-dispatch-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  backend: {
    activeLeaseRequiredForPayloadReadback: true;
    jobType: "tool.operation.dispatch_request";
    maxAttempts: number;
    requiredWorkerScope: "tools:manage";
    terminalReadbackRejectsReplay: true;
    workerQueue: "external_tool_operations";
  };
  deployment: {
    externalOperationExecutionEnabled: boolean;
    liveEvidencePathConfigured: boolean;
    networkPolicyConfigured: boolean;
    operationExecutionDriver: "disabled" | "http-fetch";
    payloadEncryptionKeyConfigured: boolean;
    payloadStoreConfigured: boolean;
    payloadStoreDriver: "disabled" | "object-store";
    workerEnabled: boolean;
  };
  queue: {
    cancelled: number;
    completed: number;
    deadLettered: number;
    expired: number;
    failed: number;
    oldestQueuedAgeSeconds: number | null;
    queued: number;
    running: number;
    staleQueued: number;
    staleRunning: number;
    total: number;
  };
  payloadStorage: {
    externalWorkerSecretStoreRequired: number;
    managedEncryptedObjectStore: number;
    unknown: number;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "satisfied";
    schemaVersion?: "romeo.tool-dispatch-live-evidence.v1";
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: {
      worker_claim_execution_verified: boolean;
      managed_payload_read_verified: boolean;
      mcp_streamable_http_tools_call_verified: boolean;
      worker_cni_egress_enforced: boolean;
      dns_private_address_denied: boolean;
      secret_resolution_verified: boolean;
      worker_crash_retry_or_reclaim_verified: boolean;
      response_schema_validation_verified: boolean;
      worker_log_redaction: boolean;
      sanitized_readback_verified: boolean;
    };
    failureCodes: string[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    summary: {
      completedDispatchCount: number;
      deniedPrivateTargetCount: number;
      dispatchRequestCount: number;
      failedDispatchCount: number;
      managedPayloadReadCount: number;
      podLogScanCount: number;
      reclaimedDispatchCount: number;
      schemaValidationCount: number;
      secretResolutionCount: number;
      workerLogScanCount: number;
    };
    mcp: {
      callCount: number;
      jsonRpcEnvelopeVerified: boolean;
      outputRedacted: boolean;
      payloadArgumentsRedacted: boolean;
      protocolHeadersVerified: boolean;
      streamableHttpToolsCallVerified: boolean;
    };
    redaction: ToolDispatchPostureLiveEvidenceRedaction;
  };
  redaction: ToolDispatchPostureRedaction & {
    evidenceFileBodiesReturned: false;
  };
  warnings: ToolDispatchPostureWarning[];
}

export interface ToolDispatchPostureRedaction {
  rawEvidencePathsReturned: boolean;
  rawObjectStoreKeysReturned: boolean;
  rawOperationHostsReturned: boolean;
  rawPayloadValuesReturned: boolean;
  rawResponseBodiesReturned: boolean;
  rawSecretRefsReturned: boolean;
  secretValuesReturned: boolean;
  tokenValuesReturned: boolean;
}

export interface ToolDispatchPostureLiveEvidenceRedaction extends ToolDispatchPostureRedaction {
  rawLogLinesReturned: boolean;
}

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

export interface ImportedToolConnector {
  connector: ToolConnector;
  operations: ToolOperation[];
}

export interface ImportOpenApiToolInput {
  name: string;
  description?: string;
  spec: Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  approvalPolicy?: ToolApprovalPolicy;
}

export interface CreateWebhookToolInput {
  name: string;
  url: string;
  bodySchema?: Record<string, unknown>;
  description?: string;
  operationName?: string;
  riskLevel?: ToolRiskLevel;
  approvalPolicy?: ToolApprovalPolicy;
}

export interface CreateMcpToolInput {
  name: string;
  serverUrl: string;
  description?: string;
  protocolVersion?: string;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  }>;
  riskLevel?: ToolRiskLevel;
  approvalPolicy?: ToolApprovalPolicy;
}

export interface UpdateToolConnectorAuthInput {
  connectorId: string;
  type: "api_key" | "bearer" | "none" | "oauth2_client_credentials";
  secretRef?: string;
  apiKeyIn?: "header" | "query";
  apiKeyName?: string;
  oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
  oauthScopes?: string[];
  oauthTokenUrl?: string;
}

export interface UpdateToolConnectorNetworkPolicyInput {
  connectorId: string;
  mode: ToolNetworkPolicy["mode"];
  allowedHosts?: string[];
  allowPrivateNetwork?: boolean;
}

export interface UpdateToolConnectorInput {
  connectorId: string;
  enabled: boolean;
}

export interface UpdateToolOperationInput {
  connectorId: string;
  operationId: string;
  enabled: boolean;
}

export interface TestToolOperationInput {
  connectorId: string;
  operationId: string;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

export interface DispatchToolOperationInput extends TestToolOperationInput {
  approved?: boolean;
  approvalRequestId?: string;
}

export interface EnqueueToolOperationDispatchInput extends DispatchToolOperationInput {
  idempotencyKey?: string;
}

export interface ClaimToolOperationDispatchRequestInput {
  leaseSeconds?: number;
  payloadStorage?: ToolOperationDispatchPayloadStorage;
}

export interface ReadToolOperationDispatchRequestPayloadInput {
  jobId: string;
}

export interface RenewToolOperationDispatchRequestLeaseInput {
  jobId: string;
  leaseSeconds?: number;
}

export interface ExpireToolOperationDispatchRequestsInput {
  queuedTimeoutSeconds?: number;
  runningTimeoutSeconds?: number;
  limit?: number;
}

export interface CompleteToolOperationDispatchRequestInput {
  jobId: string;
  response: ToolOperationDispatchReadbackResponse;
}

export interface FailToolOperationDispatchRequestInput {
  jobId: string;
  errorCode: string;
}

export interface CancelToolOperationDispatchRequestInput {
  jobId: string;
  reasonCode?: string;
}

export interface UpdateAgentToolBindingInput {
  agentId: string;
  toolId: string;
  enabled?: boolean;
  approvalRequired?: boolean;
}

export interface ExecuteToolInput {
  toolId: string;
  agentId: string;
  runId?: string;
  payload: unknown;
  approved?: boolean;
  approvalRequestId?: string;
  idempotencyKey?: string;
  modelToolCallId?: string;
}

export interface ExecuteRunToolInput {
  runId: string;
  toolId: string;
  payload: unknown;
  approved?: boolean;
  approvalRequestId?: string;
  modelToolCallId?: string;
}
