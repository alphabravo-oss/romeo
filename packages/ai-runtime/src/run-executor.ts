import type {
  ChatMessage,
  ProviderToolCallRequest,
  ProviderTokenUsage,
  StreamChatChunk,
} from "@romeo/providers";

import { createRunEvent, type RunEvent } from "./events";
import {
  ProviderStreamAborted,
  ProviderStreamFailure,
  createProviderStreamRuntime,
} from "./provider-stream-runtime";
import {
  isReasoningChunk,
  isToolCallChunk,
  isUsageChunk,
  providerApiKeyFor,
  providerToolCallRequestedData,
  providerToolsForTarget,
  sanitizeUsage,
  toolCallsFromChunk,
} from "./run-executor-chunks";
import {
  completionData,
  modelToolExecutionFailureData,
  providerFailureData,
} from "./run-executor-failures";
import type {
  ExecuteRunInput,
  ExecuteRunResult,
  ProviderFallbackSnapshot,
  ProviderFallbackTarget,
  ProviderRetryPolicy,
} from "./run-executor-types";
export * from "./provider-circuit-breaker";
export * from "./run-executor-types";

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
    // Per attempt, deliberately not per run: it decides whether abandoning this attempt leaves
    // orphaned thinking on the wire that the client has to be told to drop.
    let attemptEmittedReasoning = false;
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
              const execution =
                await input.modelToolExecutor(requestedToolCall);
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
                  providerCallIdHash:
                    toolRequestEvents[index]!.providerCallIdHash,
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

        // Reasoning is not committed output: it must not touch emittedContent/content, or a provider
        // that thinks before it speaks would lose its retry and fallback budget for free.
        if (isReasoningChunk(chunk)) {
          attemptEmittedReasoning = true;
          yield event("message.reasoning", { text: chunk.text });
          continue;
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
        // Reasoning is exempt from emittedContent (above), so an attempt can be abandoned after
        // streaming thinking that belongs to nothing. Re-announcing the message is the reset
        // marker: it already means "the assistant message starts here" -- core rebuilds content
        // from the last one -- so a client can drop the dead attempt's thinking and re-base its
        // timer instead of showing two attempts' scratchpads as one thought. It is emitted only
        // when there is orphaned thinking to disown, so every other retry looks as it always did.
        if (attemptEmittedReasoning)
          yield event("message.started", { role: "assistant" });
        continue;
      }

      if (!emittedContent && tryFallback(failure.errorCode)) {
        usage = undefined;
        // Same marker, and it matters more here: the next attempt is a different model.
        if (attemptEmittedReasoning)
          yield event("message.started", { role: "assistant" });
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
