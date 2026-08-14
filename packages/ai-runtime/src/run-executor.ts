import type {
  ChatMessage,
  ProviderToolCallRequest,
  StreamChatChunk,
} from "@romeo/providers";
import { hasRequestedProviderChatParameters } from "@romeo/providers";

import { createRunEvent, type RunEvent } from "./events";
import {
  ProviderStreamFailure,
  createProviderStreamRuntime,
} from "./provider-stream-runtime";
import {
  countsAgainstProviderHealth,
  isRetryableProviderFailure,
  normalizeProviderRetryPolicy,
  retryDelay,
} from "./provider-retry-policy";
import {
  isToolCallChunk,
  isUsageChunk,
  providerApiKeyFor,
  providerToolCallRequestedData,
  reasoningChunkEventData,
  sanitizeUsage,
  toolCallsFromChunk,
} from "./run-executor-chunks";
import {
  completionData,
  modelToolExecutionFailureData,
  providerFailureData,
} from "./run-executor-failures";
import {
  resolveRunProviderChatParameters,
  resolveRunProviderChatParametersAtAttempt,
} from "./run-executor-parameters";
import type {
  ExecuteRunInput,
  ExecuteRunResult,
  ProviderFallbackSnapshot,
  ProviderFallbackTarget,
} from "./run-executor-types";
import { ProviderUsageTracker } from "./provider-usage-tracker";
import { ReasoningSummaryTracker } from "./reasoning-summary-tracker";
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

  const retryPolicy = normalizeProviderRetryPolicy(input.providerRetryPolicy);
  let initialParameters: ReturnType<typeof resolveRunProviderChatParameters>;
  try {
    initialParameters = await resolveRunProviderChatParametersAtAttempt(input, {
      adapter: input.adapter,
      model: input.model,
      provider: input.provider,
    });
  } catch (error) {
    yield event("run.failed", providerFailureData(error));
    return;
  }
  if (input.emitRunStarted !== false) {
    yield event("run.started", {
      modelId: input.model.id,
      providerId: input.provider.id,
      // Client wait UI: how long each attempt may idle before timeout, and how
      // many retries remain after the first attempt.
      ...(input.providerTimeoutMs === undefined
        ? {}
        : { streamTimeoutMs: input.providerTimeoutMs }),
      maxRetries: retryPolicy.maxRetries,
      ...(hasRequestedProviderChatParameters(initialParameters.summary)
        ? { parameterResolution: initialParameters.summary }
        : {}),
    });
  }
  yield event("message.started", { role: "assistant" });

  let content = "";
  let currentAssistantMessageContent = "";
  const usageTracker = new ProviderUsageTracker();
  const withUsageEvidence = (data: Record<string, unknown>) => ({
    ...data,
    ...usageTracker.evidence(),
  });
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

  const maxModelToolCalls = input.maxModelToolCalls ?? 4;

  providerAttempt: while (true) {
    if (
      input.providerDisabled === true &&
      active.provider.id === input.provider.id
    ) {
      if (await tryFallback("provider_disabled")) continue;
      yield event(
        "run.failed",
        withUsageEvidence(
          providerFailureData(
            { errorCode: "provider_disabled" },
            {
              fallback: providerFallback,
              retryAttempts,
            },
          ),
        ),
      );
      return;
    }

    const circuit = input.providerCircuitBreaker?.beforeAttempt(
      active.provider.id,
    );
    if (circuit?.state === "open") {
      if (await tryFallback("provider_circuit_open")) continue;
      yield event(
        "run.failed",
        withUsageEvidence(
          providerFailureData(
            { errorCode: "provider_circuit_open" },
            {
              circuit,
              fallback: providerFallback,
              retryAttempts,
            },
          ),
        ),
      );
      return;
    }

    let chunks: AsyncIterator<StreamChatChunk> | undefined;
    let attemptEmittedReasoning = false;
    const reasoningSummary = new ReasoningSummaryTracker();
    let attemptRetainReasoningSummary = false;
    const finishReasoningSummary = (status: "completed" | "discarded") =>
      reasoningSummary.finish(
        status,
        usageTracker.currentUsage()?.reasoningTokens,
      );
    const runtime = createProviderStreamRuntime(
      input.signal,
      input.providerTimeoutMs,
    );

    try {
      const activeApiKey = providerApiKeyFor(input, active.provider.id);
      const resolvedParameters =
        await resolveRunProviderChatParametersAtAttempt(input, active);
      const parameters = resolvedParameters.effective;
      const effectiveReasoningPolicy =
        resolvedParameters.summary.reasoningPolicy?.effective;
      attemptRetainReasoningSummary =
        effectiveReasoningPolicy?.mode === "summary" &&
        effectiveReasoningPolicy.retainSummary;
      chunks = active.adapter
        .streamChat({
          messages,
          model: active.model,
          provider: active.provider,
          // Carried across retries and provider fallback: the pinned sampling belongs to the
          // managed model version, not to whichever provider ends up answering.
          ...(parameters.sampling === undefined
            ? {}
            : { sampling: parameters.sampling }),
          ...(parameters.reasoning === undefined
            ? {}
            : { reasoning: parameters.reasoning }),
          ...(parameters.structuredOutput === undefined
            ? {}
            : { structuredOutput: parameters.structuredOutput }),
          ...(activeApiKey === undefined ? {} : { apiKey: activeApiKey }),
          ...(input.fetchImpl === undefined
            ? {}
            : { fetchImpl: input.fetchImpl }),
          signal: runtime.signal,
          ...(parameters.tools === undefined
            ? {}
            : { tools: parameters.tools }),
        })
        [Symbol.asyncIterator]();

      while (true) {
        const next = await runtime.next(chunks);
        if (next.done === true) break;
        const chunk = next.value;
        runtime.markActivity();

        if (runtime.outcome === "cancelled") {
          for (const summaryEvent of finishReasoningSummary("discarded"))
            yield event(summaryEvent.type, summaryEvent.data);
          yield event("run.cancelled", withUsageEvidence({}));
          return;
        }
        if (runtime.outcome === "timeout") {
          throw new ProviderStreamFailure("provider_timeout");
        }

        if (isUsageChunk(chunk)) {
          usageTracker.observe(
            active,
            sanitizeUsage(chunk.usage, active.adapter.kind),
          );
          continue;
        }

        if (isToolCallChunk(chunk)) {
          for (const summaryEvent of finishReasoningSummary("completed"))
            yield event(summaryEvent.type, summaryEvent.data);
          usageTracker.finishAttempt();
          const requestedToolCalls = toolCallsFromChunk(chunk);
          const toolRequestEvents = requestedToolCalls.map(
            providerToolCallRequestedData,
          );
          for (const toolCall of toolRequestEvents) {
            yield event("tool.requested", toolCall);
          }
          const firstToolCall = toolRequestEvents[0]!;
          if (input.modelToolExecutor === undefined) {
            yield event(
              "run.failed",
              withUsageEvidence({
                errorCode: "provider_tool_call_dispatch_unavailable",
                providerCallIdHash: firstToolCall.providerCallIdHash,
                toolName: firstToolCall.name,
              }),
            );
            return;
          }
          if (
            modelToolCallCount + requestedToolCalls.length >
            maxModelToolCalls
          ) {
            const limitedToolCall =
              toolRequestEvents[maxModelToolCalls - modelToolCallCount] ??
              toolRequestEvents.at(-1)!;
            yield event(
              "run.failed",
              withUsageEvidence({
                errorCode: "model_tool_call_limit_exceeded",
                providerCallIdHash: limitedToolCall.providerCallIdHash,
                toolName: limitedToolCall.name,
              }),
            );
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
                yield event(
                  "run.waiting_tool_dispatch",
                  withUsageEvidence({
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
                  }),
                );
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
                yield event(
                  "run.waiting_tool_approval",
                  withUsageEvidence(failure),
                );
                return;
              }
              yield event("run.failed", withUsageEvidence(failure));
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
          if (attemptEmittedReasoning)
            yield event("message.started", { role: "assistant" });
          continue providerAttempt;
        }

        const reasoning = reasoningChunkEventData(
          chunk,
          attemptEmittedReasoning,
          attemptRetainReasoningSummary,
        );
        if (reasoning !== undefined) {
          attemptEmittedReasoning = true;
          if (reasoning.event !== undefined) {
            if (reasoning.event.type === "reasoning.summary.delta") {
              reasoningSummary.observe(
                typeof reasoning.event.data.text === "string"
                  ? reasoning.event.data.text
                  : "",
              );
            }
            if (reasoning.event.type !== "reasoning.summary.delta")
              yield event(reasoning.event.type, reasoning.event.data);
          }
          continue;
        }

        const token = chunk;
        emittedContent = true;
        content += token;
        currentAssistantMessageContent += token;
        yield event("message.delta", { text: token });
      }

      for (const summaryEvent of finishReasoningSummary("completed"))
        yield event(summaryEvent.type, summaryEvent.data);
      input.providerCircuitBreaker?.recordSuccess(active.provider.id);
      yield event("message.completed", { role: "assistant", content });
      const usageEvidence = usageTracker.evidence();
      yield event(
        "run.completed",
        completionData(
          usageEvidence.usage,
          retryAttempts,
          providerFallback,
          usageEvidence.usageSegments,
        ),
      );
      return;
    } catch (error) {
      for (const summaryEvent of finishReasoningSummary("discarded"))
        yield event(summaryEvent.type, summaryEvent.data);
      if (runtime.outcome === "cancelled") {
        yield event("run.cancelled", withUsageEvidence({}));
        return;
      }
      const failure: { errorCode: string; errorType?: string } =
        runtime.outcome === "timeout"
          ? { errorCode: "provider_timeout", errorType: "timeout" }
          : providerFailureData(error);
      // A malformed payload is not a provider health signal: the breaker keys on providerId alone, so
      // one tenant's oversized request could otherwise open the circuit for every tenant on that provider.
      const circuitState = countsAgainstProviderHealth(failure.errorType)
        ? input.providerCircuitBreaker?.recordFailure(active.provider.id)
        : input.providerCircuitBreaker?.snapshot(active.provider.id);
      const currentRetryAttempts =
        retryAttemptsByProvider.get(active.provider.id) ?? 0;
      usageTracker.finishAttempt();

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
          yield event("run.cancelled", withUsageEvidence({}));
          return;
        }
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

      if (!emittedContent && (await tryFallback(failure.errorCode))) {
        // Same marker, and it matters more here: the next attempt is a different model.
        if (attemptEmittedReasoning)
          yield event("message.started", { role: "assistant" });
        continue;
      }

      const usageEvidence = usageTracker.evidence();
      yield event(
        "run.failed",
        providerFailureData(failure, {
          circuit: circuitState,
          fallback: providerFallback,
          retryAttempts,
          ...usageEvidence,
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

  async function tryFallback(reason: string): Promise<boolean> {
    if (fallback === undefined || emittedContent) return false;
    const fallbackParameters = await resolveRunProviderChatParametersAtAttempt(
      input,
      fallback,
    );
    providerFallback = {
      fromModelId: active.model.id,
      fromProviderId: active.provider.id,
      ...(hasRequestedProviderChatParameters(fallbackParameters.summary)
        ? { parameterResolution: fallbackParameters.summary }
        : {}),
      reason,
      toModelId: fallback.model.id,
      toProviderId: fallback.provider.id,
    };
    active = fallback;
    fallback = undefined;
    return true;
  }
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
