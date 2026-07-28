import type {
  ModelProviderAdapter,
  ProviderToolCallRequest,
  StreamChatInput,
} from "@romeo/providers";

import type { RunEvent } from "./events";
import type { ProviderCircuitBreaker } from "./provider-circuit-breaker";

export interface ExecuteRunInput extends StreamChatInput {
  adapter: ModelProviderAdapter;
  emitRunStarted?: boolean;
  maxModelToolCalls?: number;
  modelToolExecutor?: (
    toolCall: ProviderToolCallRequest,
  ) => Promise<ModelToolExecutionResult>;
  providerDisabled?: boolean;
  providerApiKeys?: Record<string, string>;
  providerCircuitBreaker?: ProviderCircuitBreaker;
  providerFallback?: ProviderFallbackTarget;
  providerRetryPolicy?: Partial<ProviderRetryPolicy>;
  providerTimeoutMs?: number;
  runId: string;
}

export interface ModelToolExecutionResult {
  content: string;
  suspend?: {
    type: "tool_dispatch";
    bodyKeys?: string[];
    connectorId: string;
    jobId: string;
    operationId: string;
    parameterKeys?: string[];
    payloadStorage?:
      | "external_worker_secret_store_required"
      | "managed_encrypted_object_store";
    workerQueue: "external_tool_operations";
  };
}

export interface ExecuteRunResult {
  content: string;
  events: RunEvent[];
}

export interface ProviderRetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export interface ProviderFallbackTarget {
  adapter: ModelProviderAdapter;
  model: StreamChatInput["model"];
  provider: StreamChatInput["provider"];
}

export interface ProviderFallbackSnapshot {
  fromModelId: string;
  fromProviderId: string;
  reason: string;
  toModelId: string;
  toProviderId: string;
}
