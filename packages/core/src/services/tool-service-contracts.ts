import type { AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";

import type { ToolConnector, ToolOperation } from "../domain/entities";
import {
  lookupNetworkHost,
  type WebsiteConnectorHostLookup,
} from "./data-connector-network-policy";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

export interface ToolServiceOptions {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  externalOperationExecutionEnabled?: boolean;
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxBytes?: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  quotaCoordinator?: QuotaCoordinator | undefined;
  secretResolver?: SecretResolver;
  timeoutMs?: number;
}

/**
 * Egress wiring for tool operation dispatch, shared by every call site that
 * builds a DispatchToolOperationInput.
 *
 * Real DNS resolution and pinning are the default. An injected fetchImpl means
 * a test double or an offline transport, where there is no host to resolve, so
 * pinning is left off and the dispatch host check falls back to its literal
 * private-network guard. Explicit options always win over both.
 */
export function toolDispatchEgressOptions(options: ToolServiceOptions): {
  hostLookup?: WebsiteConnectorHostLookup;
  pinnedFetchImpl?: DnsPinnedFetch;
} {
  if (options.hostLookup !== undefined || options.pinnedFetchImpl !== undefined)
    return {
      ...(options.hostLookup === undefined
        ? {}
        : { hostLookup: options.hostLookup }),
      ...(options.pinnedFetchImpl === undefined
        ? {}
        : { pinnedFetchImpl: options.pinnedFetchImpl }),
    };
  if (options.fetchImpl !== undefined) return {};
  return { hostLookup: lookupNetworkHost, pinnedFetchImpl: dnsPinnedFetch };
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
