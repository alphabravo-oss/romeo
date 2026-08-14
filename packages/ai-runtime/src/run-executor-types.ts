import type {
  ModelProviderAdapter,
  ProviderChatParameterResolutionSummary,
  ProviderToolCallRequest,
  StreamChatInput,
  ProviderReasoningPolicyLayers,
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
  /** Re-resolves mutable governance immediately before every retry/fallback attempt. */
  reasoningPolicyResolver?: (
    target: Pick<ProviderFallbackTarget, "model" | "provider">,
  ) => Promise<ProviderReasoningPolicyLayers | undefined>;
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
  parameterResolution?: ProviderChatParameterResolutionSummary;
  reason: string;
  toModelId: string;
  toProviderId: string;
}
