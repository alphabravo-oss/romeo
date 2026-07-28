import type { AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";

import type { ToolConnector, ToolOperation } from "../domain/entities";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

export interface ToolServiceOptions {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  externalOperationExecutionEnabled?: boolean;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  quotaCoordinator?: QuotaCoordinator | undefined;
  secretResolver?: SecretResolver;
  timeoutMs?: number;
}

export interface OperationToolContext {
  connector: ToolConnector;
  operation: ToolOperation;
  tool: ToolDefinition;
}

export type ToolApprovalDecisionStatus = "approved" | "cancelled" | "rejected";

export interface ToolApprovalDecisionResult {
  approvedAt?: string;
  approvalRequestId: string;
  cancelledAt?: string;
  decidedAt: string;
  rejectedAt?: string;
  status: ToolApprovalDecisionStatus;
  toolId: string;
  agentId?: string;
  runId?: string;
  workspaceId?: string;
}

export interface ToolApprovalRequestSummary {
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

export interface ToolExecutionOptions {
  agentId: string;
  approved?: boolean;
  approvalRequestId?: string;
  idempotencyKey?: string;
  runId?: string;
}

export interface ToolExecutionIdempotencyInput {
  subject: AuthSubject;
  agent: { id: string; workspaceId: string };
  tool: Pick<ToolDefinition, "id">;
  runId: string | undefined;
  idempotencyKey: string;
  requestInput: unknown;
}
