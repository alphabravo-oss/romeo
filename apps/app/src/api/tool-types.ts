export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  riskLevel: string;
  approvalPolicy: string;
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

export interface ToolConnector {
  id: string;
  type: "built_in" | "openapi" | "mcp" | "webhook" | "browser" | "enterprise";
  name: string;
  description: string;
  schema: Record<string, unknown>;
  authConfig: Record<string, unknown>;
  networkPolicy: {
    mode: "deny_all" | "allow_hosts";
    allowedHosts: string[];
    allowPrivateNetwork: boolean;
  };
  riskLevel: string;
  approvalPolicy: string;
  visibility: string;
  enabled: boolean;
}

export interface ToolOperation {
  id: string;
  connectorId: string;
  operationId: string;
  method: string;
  path: string;
  name: string;
  description: string;
  riskLevel: string;
  approvalPolicy: string;
  enabled: boolean;
}

export type ToolOperationTestDisabledReason =
  | "auth_not_configured"
  | "base_url_missing"
  | "connector_disabled"
  | "external_execution_disabled"
  | "network_policy_missing"
  | "operation_disabled";

export interface ToolOperationTestPreview {
  connectorId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  riskLevel: string;
  approvalPolicy: string;
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
      mode: "deny_all" | "allow_hosts";
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
