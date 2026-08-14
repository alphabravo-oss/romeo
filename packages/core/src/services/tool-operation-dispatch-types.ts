import type { AuthSubject } from "@romeo/auth";

import type { ToolConnector, ToolOperation } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { WebsiteConnectorHostLookup } from "./data-connector-network-policy";
import type { DnsPinnedFetch } from "./dns-pinned-fetch";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

export interface DispatchToolOperationInput {
  approvalRequestId?: string;
  approved?: boolean;
  body?: Record<string, unknown>;
  connector: ToolConnector;
  externalExecutionEnabled: boolean;
  fetchImpl: typeof fetch;
  /** Resolves the dispatch host so egress policy can inspect the addresses. */
  hostLookup?: WebsiteConnectorHostLookup;
  maxBytes: number;
  /** Connects only to addresses the egress policy approved. */
  pinnedFetchImpl?: DnsPinnedFetch;
  operation: ToolOperation;
  parameters?: Record<string, unknown>;
  repository: RomeoRepository;
  secretResolver: SecretResolver;
  subject: AuthSubject;
  timeoutMs: number;
}

export interface EnqueueToolOperationDispatchInput extends DispatchToolOperationInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  idempotencyKey?: string;
  requiredScope?: "tools:manage" | "tools:use";
  runContext?: {
    agentId: string;
    runId: string;
    toolId: string;
    workspaceId: string;
  };
}
