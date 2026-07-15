import type {
  ChatMessage,
  ModelProviderAdapter,
  ProviderToolCallRequest,
  ProviderTokenUsage,
  StreamChatChunk,
  StreamChatInput,
} from "@romeo/providers";
import { providerToolCallRedactionHash } from "@romeo/providers";

import { createRunEvent, type RunEvent } from "./events";

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

export interface ProviderCircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export interface ProviderCircuitBreakerSnapshot {
  consecutiveFailures: number;
  state: "closed" | "half_open" | "open";
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

type CircuitRecord = ProviderCircuitBreakerSnapshot & { openedAtMs?: number };

export class ProviderCircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();

  constructor(
    private readonly policy: ProviderCircuitBreakerPolicy = {
      failureThreshold: 5,
      cooldownMs: 60_000,
    },
  ) {}

  beforeAttempt(providerId: string): ProviderCircuitBreakerSnapshot {
    const record = this.records.get(providerId);
    if (record === undefined) return closedCircuit();
    if (record.state !== "open") return snapshot(record);
    if (
      this.policy.cooldownMs > 0 &&
      record.openedAtMs !== undefined &&
      Date.now() - record.openedAtMs < this.policy.cooldownMs
    ) {
      return snapshot(record);
    }
    const halfOpen: CircuitRecord = {
      state: "half_open",
      consecutiveFailures: record.consecutiveFailures,
    };
    this.records.set(providerId, halfOpen);
    return snapshot(halfOpen);
  }

  recordSuccess(providerId: string): ProviderCircuitBreakerSnapshot {
    const next = closedCircuit();
    this.records.set(providerId, next);
    return snapshot(next);
  }

  snapshot(providerId: string): ProviderCircuitBreakerSnapshot {
    return snapshot(this.records.get(providerId) ?? closedCircuit());
  }

  recordFailure(providerId: string): ProviderCircuitBreakerSnapshot {
    if (this.policy.failureThreshold <= 0) return closedCircuit();
    const current = this.records.get(providerId) ?? closedCircuit();
    const consecutiveFailures =
      current.state === "half_open"
        ? this.policy.failureThreshold
        : current.consecutiveFailures + 1;
    const state =
      consecutiveFailures >= this.policy.failureThreshold ? "open" : "closed";
    const next: CircuitRecord = {
      state,
      consecutiveFailures,
      ...(state === "open" ? { openedAtMs: Date.now() } : {}),
    };
    this.records.set(providerId, next);
    return snapshot(next);
  }
}

export async function* streamRunEvents(
  input: ExecuteRunInput,
): AsyncIterable<RunEvent> {
  let sequence = 0;

  function event(type: RunEvent["type"], data: unknown): RunEvent {
    sequence += 1;
    return createRunEvent({ runId: input.runId, sequence, type, data });
  }

  if (input.emitRunStarted !== false) {
    yield event("run.started", {
      modelId: input.model.id,
      providerId: input.provider.id,
    });
  }
  yield event("message.started", { role: "assistant" });

  let content = "";
  let currentAssistantMessageContent = "";
  let usage: ProviderTokenUsage | undefined;
  let emittedContent = false;
  let modelToolCallCount = 0;
  let messages: ChatMessage[] = input.messages;
  let retryAttempts = 0;
  let active: ProviderFallbackTarget = {
    adapter: input.adapter,
    model: input.model,
    provider: input.provider,
  };
  let fallback: ProviderFallbackTarget | undefined = input.providerFallback;
  let providerFallback: ProviderFallbackSnapshot | undefined;
  const retryAttemptsByProvider = new Map<string, number>();
  const retryPolicy = normalizeProviderRetryPolicy(input.providerRetryPolicy);

  const maxModelToolCalls = input.maxModelToolCalls ?? 4;

  providerAttempt: while (true) {
    if (
      input.providerDisabled === true &&
      active.provider.id === input.provider.id
    ) {
      if (tryFallback("provider_disabled")) continue;
      yield event(
        "run.failed",
        providerFailureData(
          { errorCode: "provider_disabled" },
          {
            fallback: providerFallback,
            retryAttempts,
          },
        ),
      );
      return;
    }

    const circuit = input.providerCircuitBreaker?.beforeAttempt(
      active.provider.id,
    );
    if (circuit?.state === "open") {
      if (tryFallback("provider_circuit_open")) continue;
      yield event(
        "run.failed",
        providerFailureData(
          { errorCode: "provider_circuit_open" },
          {
            circuit,
            fallback: providerFallback,
            retryAttempts,
          },
        ),
      );
      return;
    }

    let chunks: AsyncIterator<StreamChatChunk> | undefined;
    const runtime = createProviderStreamRuntime(
      input.signal,
      input.providerTimeoutMs,
    );

    try {
      const activeApiKey = providerApiKeyFor(input, active.provider.id);
      const activeTools = providerToolsForTarget(active, input.tools);
      chunks = active.adapter
        .streamChat({
          messages,
          model: active.model,
          provider: active.provider,
          ...(activeApiKey === undefined ? {} : { apiKey: activeApiKey }),
          ...(input.fetchImpl === undefined
            ? {}
            : { fetchImpl: input.fetchImpl }),
          signal: runtime.signal,
          ...(activeTools === undefined ? {} : { tools: activeTools }),
        })
        [Symbol.asyncIterator]();

      while (true) {
        const next = await runtime.next(chunks);
        if (next.done === true) break;
        const chunk = next.value;
        runtime.markActivity();

        if (runtime.outcome === "cancelled") {
          yield event("run.cancelled", {});
          return;
        }
        if (runtime.outcome === "timeout") {
          throw new ProviderStreamFailure("provider_stream_timeout");
        }

        if (isUsageChunk(chunk)) {
          usage = sanitizeUsage(chunk.usage);
          continue;
        }

        if (isToolCallChunk(chunk)) {
          const requestedToolCalls = toolCallsFromChunk(chunk);
          const toolRequestEvents = requestedToolCalls.map(
            providerToolCallRequestedData,
          );
          for (const toolCall of toolRequestEvents) {
            yield event("tool.requested", toolCall);
          }
          const firstToolCall = toolRequestEvents[0]!;
          if (input.modelToolExecutor === undefined) {
            yield event("run.failed", {
              errorCode: "provider_tool_call_dispatch_unavailable",
              providerCallIdHash: firstToolCall.providerCallIdHash,
              toolName: firstToolCall.name,
            });
            return;
          }
          if (
            modelToolCallCount + requestedToolCalls.length >
            maxModelToolCalls
          ) {
            const limitedToolCall =
              toolRequestEvents[maxModelToolCalls - modelToolCallCount] ??
              toolRequestEvents.at(-1)!;
            yield event("run.failed", {
              errorCode: "model_tool_call_limit_exceeded",
              providerCallIdHash: limitedToolCall.providerCallIdHash,
              toolName: limitedToolCall.name,
            });
            return;
          }

          const toolResults: Array<{
            content: string;
            toolCall: ProviderToolCallRequest;
          }> = [];
          for (const [
            index,
            requestedToolCall,
          ] of requestedToolCalls.entries()) {
            try {
              const execution = await input.modelToolExecutor(
                requestedToolCall,
              );
              if (execution.suspend?.type === "tool_dispatch") {
                yield event("run.waiting_tool_dispatch", {
                  connectorId: execution.suspend.connectorId,
                  errorCode: "tool_operation_dispatch_queued",
                  jobId: execution.suspend.jobId,
                  operationId: execution.suspend.operationId,
                  ...(execution.suspend.parameterKeys === undefined
                    ? {}
                    : { parameterKeys: execution.suspend.parameterKeys }),
                  ...(execution.suspend.bodyKeys === undefined
                    ? {}
                    : { bodyKeys: execution.suspend.bodyKeys }),
                  ...(execution.suspend.payloadStorage === undefined
                    ? {}
                    : { payloadStorage: execution.suspend.payloadStorage }),
                  providerCallIdHash: toolRequestEvents[index]!
                    .providerCallIdHash,
                  toolName: toolRequestEvents[index]!.name,
                  workerQueue: execution.suspend.workerQueue,
                });
                return;
              }
              toolResults.push({
                toolCall: requestedToolCall,
                content: execution.content,
              });
            } catch (error) {
              const failure = modelToolExecutionFailureData(
                error,
                toolRequestEvents[index]!,
              );
              if (failure.errorCode === "tool_approval_required") {
                yield event("run.waiting_tool_approval", failure);
                return;
              }
              yield event("run.failed", failure);
              return;
            }
          }

          modelToolCallCount += requestedToolCalls.length;
          messages = [
            ...messages,
            {
              role: "assistant",
              content: currentAssistantMessageContent,
              toolCalls: requestedToolCalls,
            },
            ...toolResults.map(({ content: resultContent, toolCall }) => ({
              role: "tool" as const,
              content: resultContent,
              name: toolCall.name,
              toolCallId: toolCall.providerCallId,
            })),
          ];
          currentAssistantMessageContent = "";
          usage = undefined;
          continue providerAttempt;
        }

        const token = chunk;
        emittedContent = true;
        content += token;
        currentAssistantMessageContent += token;
        yield event("message.delta", { text: token });
      }

      input.providerCircuitBreaker?.recordSuccess(active.provider.id);
      yield event("message.completed", { role: "assistant", content });
      yield event(
        "run.completed",
        completionData(usage, retryAttempts, providerFallback),
      );
      return;
    } catch (error) {
      if (runtime.outcome === "cancelled") {
        yield event("run.cancelled", {});
        return;
      }
      const failure: { errorCode: string; errorType?: string } =
        runtime.outcome === "timeout"
          ? { errorCode: "provider_stream_timeout" }
          : providerFailureData(error);
      // A malformed payload is not a provider health signal: the breaker keys on providerId alone, so
      // one tenant's oversized request could otherwise open the circuit for every tenant on that provider.
      const circuitState = countsAgainstProviderHealth(failure.errorType)
        ? input.providerCircuitBreaker?.recordFailure(active.provider.id)
        : input.providerCircuitBreaker?.snapshot(active.provider.id);
      const currentRetryAttempts =
        retryAttemptsByProvider.get(active.provider.id) ?? 0;

      if (
        isRetryableProviderFailure(failure.errorCode) &&
        !emittedContent &&
        currentRetryAttempts < retryPolicy.maxRetries
      ) {
        retryAttemptsByProvider.set(
          active.provider.id,
          currentRetryAttempts + 1,
        );
        retryAttempts += 1;
        try {
          await retryDelay(retryPolicy.backoffMs, input.signal);
        } catch {
          yield event("run.cancelled", {});
          return;
        }
        usage = undefined;
        continue;
      }

      if (!emittedContent && tryFallback(failure.errorCode)) {
        usage = undefined;
        continue;
      }

      yield event(
        "run.failed",
        providerFailureData(failure, {
          circuit: circuitState,
          fallback: providerFallback,
          retryAttempts,
        }),
      );
      return;
    } finally {
      runtime.clear();
      try {
        await chunks?.return?.();
      } catch {
        // Provider cleanup errors must not replace the sanitized terminal event.
      }
    }
  }

  function tryFallback(reason: string): boolean {
    if (fallback === undefined || emittedContent) return false;
    providerFallback = {
      fromModelId: active.model.id,
      fromProviderId: active.provider.id,
      reason,
      toModelId: fallback.model.id,
      toProviderId: fallback.provider.id,
    };
    active = fallback;
    fallback = undefined;
    return true;
  }
}

function providerApiKeyFor(
  input: ExecuteRunInput,
  providerId: string,
): string | undefined {
  const scopedApiKey = input.providerApiKeys?.[providerId];
  if (scopedApiKey !== undefined) return scopedApiKey;
  return providerId === input.provider.id ? input.apiKey : undefined;
}

function providerToolsForTarget(
  target: ProviderFallbackTarget,
  tools: StreamChatInput["tools"],
): StreamChatInput["tools"] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  if (
    target.provider.capabilities.toolCalling !== true ||
    target.model.capabilities.toolCalling !== true
  ) {
    return undefined;
  }
  return tools;
}

function providerFailureData(
  error: unknown,
  metadata: {
    circuit?: ProviderCircuitBreakerSnapshot | undefined;
    fallback?: ProviderFallbackSnapshot | undefined;
    retryAttempts?: number | undefined;
  } = {},
): {
  errorCode: string;
  errorType?: string;
  providerCircuit?: ProviderCircuitBreakerSnapshot;
  providerFallback?: ProviderFallbackSnapshot;
  retryAttempts?: number;
} {
  const result: {
    errorCode: string;
    errorType?: string;
    providerCircuit?: ProviderCircuitBreakerSnapshot;
    providerFallback?: ProviderFallbackSnapshot;
    retryAttempts?: number;
  } = isProviderFailureRecord(error)
    ? {
        errorCode: error.errorCode,
        ...(typeof error.errorType === "string"
          ? { errorType: error.errorType }
          : {}),
      }
    : error instanceof Error && error.name === "AbortError"
      ? { errorCode: "provider_stream_aborted", errorType: "AbortError" }
      : { errorCode: "provider_stream_error" };
  if (metadata.retryAttempts !== undefined && metadata.retryAttempts > 0) {
    result.retryAttempts = metadata.retryAttempts;
  }
  if (metadata.circuit !== undefined && metadata.circuit.state !== "closed") {
    result.providerCircuit = metadata.circuit;
  }
  if (metadata.fallback !== undefined) {
    result.providerFallback = metadata.fallback;
  }
  return result;
}

function modelToolExecutionFailureData(
  error: unknown,
  toolCall: ReturnType<typeof providerToolCallRequestedData>,
): {
  approvalRequestId?: string;
  errorCode: string;
  providerCallIdHash: string;
  toolName: string;
} {
  const approvalRequestId = approvalRequestIdField(error);
  return {
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    errorCode: modelToolExecutionErrorCode(error),
    providerCallIdHash: toolCall.providerCallIdHash,
    toolName: toolCall.name,
  };
}

function modelToolExecutionErrorCode(error: unknown): string {
  const code = errorCodeField(error);
  return code === undefined || !knownModelToolErrorCodes.has(code)
    ? "model_tool_execution_failed"
    : code;
}

function errorCodeField(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { code?: unknown; errorCode?: unknown };
  if (typeof record.errorCode === "string") return record.errorCode;
  if (typeof record.code === "string") return record.code;
  return undefined;
}

function approvalRequestIdField(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return undefined;
  const approvalRequestId = (details as { approvalRequestId?: unknown })
    .approvalRequestId;
  return typeof approvalRequestId === "string" &&
    approvalRequestId.length > 0 &&
    approvalRequestId.length <= 200
    ? approvalRequestId
    : undefined;
}

const knownModelToolErrorCodes = new Set([
  "invalid_request",
  "invalid_tool_approval_request",
  "not_found",
  "tool_approval_request_expired",
  "tool_approval_request_required",
  "tool_approval_required",
  "tool_execution_error",
  "tool_execution_replayed",
  "tool_not_bound",
]);

function completionData(
  usage: ProviderTokenUsage | undefined,
  retryAttempts: number,
  fallback: ProviderFallbackSnapshot | undefined,
): Record<string, unknown> {
  return {
    ...(usage === undefined ? {} : { usage }),
    ...(fallback === undefined ? {} : { providerFallback: fallback }),
    ...(retryAttempts > 0 ? { providerRetryAttempts: retryAttempts } : {}),
  };
}

function isProviderFailureRecord(
  value: unknown,
): value is { errorCode: string; errorType?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "errorCode" in value &&
    typeof value.errorCode === "string"
  );
}

function normalizeProviderRetryPolicy(
  input: Partial<ProviderRetryPolicy> | undefined,
): ProviderRetryPolicy {
  return {
    maxRetries: nonNegativeInteger(input?.maxRetries),
    backoffMs: nonNegativeInteger(input?.backoffMs),
  };
}

function nonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : 0;
}

function isRetryableProviderFailure(errorCode: string): boolean {
  return (
    errorCode === "provider_stream_error" ||
    errorCode === "provider_stream_timeout"
  );
}

// Only rejections of the request payload itself are excluded. 401/403/404/429/5xx must keep counting:
// a revoked key is exactly the condition the breaker exists to back off from.
const clientPayloadErrorTypes = new Set(["http_400", "http_413", "http_422"]);

function countsAgainstProviderHealth(errorType: string | undefined): boolean {
  return errorType === undefined || !clientPayloadErrorTypes.has(errorType);
}

function retryDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true)
    return Promise.reject(new ProviderStreamAborted());
  if (ms <= 0) return Promise.resolve();
  let abort: (() => void) | undefined;
  const delay = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timeout);
      reject(new ProviderStreamAborted());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  return delay.finally(() => {
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  });
}

function closedCircuit(): CircuitRecord {
  return { state: "closed", consecutiveFailures: 0 };
}

function snapshot(record: CircuitRecord): ProviderCircuitBreakerSnapshot {
  return {
    state: record.state,
    consecutiveFailures: record.consecutiveFailures,
  };
}

class ProviderStreamFailure extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
  }
}

type ProviderStreamOutcome = "cancelled" | "timeout";

class ProviderStreamAborted extends Error {
  constructor() {
    super("Provider stream aborted.");
  }
}

function createProviderStreamRuntime(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  clear(): void;
  markActivity(): void;
  next(
    iterator: AsyncIterator<StreamChatChunk>,
  ): Promise<IteratorResult<StreamChatChunk>>;
  outcome: ProviderStreamOutcome | undefined;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let outcome: ProviderStreamOutcome | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const armTimeout = () => {
    if (timeoutMs === undefined) return;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => abort("timeout"), timeoutMs);
  };
  const abort = (nextOutcome: ProviderStreamOutcome) => {
    outcome ??= nextOutcome;
    if (!controller.signal.aborted) controller.abort();
  };
  const abortForParent = () => abort("cancelled");

  if (parentSignal?.aborted === true) {
    abortForParent();
  } else {
    parentSignal?.addEventListener("abort", abortForParent, { once: true });
  }

  if (timeoutMs !== undefined) {
    armTimeout();
  }

  return {
    clear() {
      if (timeout !== undefined) clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortForParent);
    },
    markActivity() {
      armTimeout();
    },
    next(iterator) {
      if (controller.signal.aborted)
        return Promise.reject(new ProviderStreamAborted());
      return new Promise((resolve, reject) => {
        const abortListener = () => reject(new ProviderStreamAborted());
        controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
        iterator
          .next()
          .then(resolve, reject)
          .finally(() => {
            controller.signal.removeEventListener("abort", abortListener);
          });
      });
    },
    get outcome() {
      return outcome;
    },
    signal: controller.signal,
  };
}

function isUsageChunk(
  chunk: StreamChatChunk,
): chunk is { type: "usage"; usage: ProviderTokenUsage } {
  return typeof chunk === "object" && chunk !== null && chunk.type === "usage";
}

function isToolCallChunk(chunk: StreamChatChunk): chunk is {
  type: "tool_call";
  toolCall: ProviderToolCallRequest;
  toolCalls?: ProviderToolCallRequest[];
} {
  return (
    typeof chunk === "object" && chunk !== null && chunk.type === "tool_call"
  );
}

function toolCallsFromChunk(chunk: {
  toolCall: ProviderToolCallRequest;
  toolCalls?: ProviderToolCallRequest[];
}): ProviderToolCallRequest[] {
  return chunk.toolCalls === undefined || chunk.toolCalls.length === 0
    ? [chunk.toolCall]
    : chunk.toolCalls;
}

function providerToolCallRequestedData(toolCall: ProviderToolCallRequest): {
  argumentCount: number;
  argumentKeys: string[];
  name: string;
  providerCallIdHash: string;
} {
  const argumentKeys = [...toolCall.argumentKeys].sort();
  return {
    argumentCount: argumentKeys.length,
    argumentKeys,
    name: toolCall.name,
    providerCallIdHash: providerToolCallRedactionHash(
      `provider.tool_call.event.v1\0${toolCall.providerCallId}`,
    ),
  };
}

function sanitizeUsage(usage: ProviderTokenUsage): ProviderTokenUsage {
  const sanitized: ProviderTokenUsage = {};
  if (isNonNegativeInteger(usage.inputTokens))
    sanitized.inputTokens = usage.inputTokens;
  if (isNonNegativeInteger(usage.outputTokens))
    sanitized.outputTokens = usage.outputTokens;
  if (isNonNegativeInteger(usage.totalTokens))
    sanitized.totalTokens = usage.totalTokens;
  if (typeof usage.source === "string" && usage.source.length > 0)
    sanitized.source = usage.source.slice(0, 80);
  return sanitized;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

export async function executeRun(
  input: ExecuteRunInput,
): Promise<ExecuteRunResult> {
  const events: RunEvent[] = [];
  let content = "";

  for await (const event of streamRunEvents(input)) {
    events.push(event);
    if (event.type === "message.delta") {
      content += (event.data as { text: string }).text;
    }
  }

  return { content, events };
}

