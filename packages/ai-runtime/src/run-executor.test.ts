import type {
  BaseModel,
  ModelProviderAdapter,
  ProviderInstance,
  StreamChatInput,
} from "@romeo/providers";
import { normalizeProviderToolCall } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import type { RunEvent } from "./events";
import { ProviderCircuitBreaker, streamRunEvents } from "./run-executor";

describe("streamRunEvents", () => {
  it("redacts provider exception messages from failed run events", async () => {
    const rawPrompt = "raw-provider-outage-prompt-secret";
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        throw new Error(`Provider included raw prompt: ${rawPrompt}`);
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_outage",
        messages: [{ role: "user", content: rawPrompt }],
      }),
    );

    const failed = events.find((event) => event.type === "run.failed");
    expect(failed?.data).toEqual({ errorCode: "provider_stream_error" });
    expect(JSON.stringify(events)).not.toContain(rawPrompt);
  });

  it("emits a terminal cancellation without provider text when the run signal is aborted", async () => {
    const controller = new AbortController();
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        controller.abort();
        yield "provider text after cancellation";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_cancelled",
        messages: [{ role: "user", content: "cancel this run" }],
        signal: controller.signal,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "run.cancelled",
    ]);
    expect(JSON.stringify(events)).not.toContain(
      "provider text after cancellation",
    );
  });

  it("fails a stalled provider stream without emitting delayed provider text", async () => {
    const rawText = "provider text after idle timeout";
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        await sleep(30);
        yield rawText;
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_timeout",
        messages: [{ role: "user", content: "time out this run" }],
        providerTimeoutMs: 5,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "run.failed",
    ]);
    expect(events.at(-1)?.data).toEqual({
      errorCode: "provider_stream_timeout",
    });
    expect(JSON.stringify(events)).not.toContain(rawText);
  });

  it("does not timeout an active provider stream between chunks", async () => {
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        yield "hello";
        await sleep(5);
        yield " world";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_active_stream",
        messages: [{ role: "user", content: "finish this run" }],
        providerTimeoutMs: 20,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.delta",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(events.at(-1)?.data).toEqual({});
  });

  it("passes active provider credentials, fetch, and tools into tool-capable adapters", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null);
    const tools = [
      {
        name: "tool_calculator",
        description: "Evaluate arithmetic.",
        parameters: {
          type: "object",
          properties: { expression: { type: "string" } },
          required: ["expression"],
          additionalProperties: false,
        },
      },
    ];
    let seenInput: StreamChatInput | undefined;
    const toolCapableProvider: ProviderInstance = {
      ...provider,
      capabilities: { ...provider.capabilities, toolCalling: true },
    };
    const toolCapableModel: BaseModel = {
      ...model,
      capabilities: toolCapableProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [toolCapableModel];
      },
      async *streamChat(input) {
        seenInput = input;
        yield "hello";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: toolCapableProvider,
        model: toolCapableModel,
        apiKey: "provider-api-key",
        fetchImpl,
        runId: "run_provider_forwarded_input",
        messages: [{ role: "user", content: "use available tools" }],
        tools,
      }),
    );

    expect(events.at(-1)?.type).toBe("run.completed");
    expect(seenInput?.apiKey).toBe("provider-api-key");
    expect(seenInput?.fetchImpl).toBe(fetchImpl);
    expect(seenInput?.tools).toEqual(tools);
  });

  it("emits sanitized provider tool requests and fails closed without an executor", async () => {
    const rawArgumentValue = "raw-provider-tool-argument-secret";
    const rawProviderCallId = "raw-provider-call-id-secret";
    const toolCall = normalizeProviderToolCall({
      id: rawProviderCallId,
      type: "function",
      function: {
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: rawArgumentValue }),
      },
    });
    if (toolCall === undefined)
      throw new Error("Expected normalized tool call");
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        yield { type: "tool_call", toolCall };
        yield "provider text that must not be emitted";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_tool_call",
        messages: [{ role: "user", content: "use a tool" }],
      }),
    );
    const requested = events.find((event) => event.type === "tool.requested");

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "tool.requested",
      "run.failed",
    ]);
    expect(requested?.data).toMatchObject({
      argumentCount: 1,
      argumentKeys: ["expression"],
      name: "tool_calculator",
    });
    expect(
      (requested?.data as { providerCallIdHash?: string }).providerCallIdHash,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(events.at(-1)?.data).toMatchObject({
      errorCode: "provider_tool_call_dispatch_unavailable",
      toolName: "tool_calculator",
    });
    expect(JSON.stringify(events)).not.toContain(rawArgumentValue);
    expect(JSON.stringify(events)).not.toContain(rawProviderCallId);
    expect(JSON.stringify(events)).not.toContain(
      "provider text that must not be emitted",
    );
  });

  it("executes model-requested tools and resumes the provider stream", async () => {
    const toolCall = normalizeProviderToolCall({
      id: "raw-provider-tool-call-secret",
      type: "function",
      function: {
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: "2 + 2" }),
      },
    });
    if (toolCall === undefined)
      throw new Error("Expected normalized tool call");

    const providerInputs: StreamChatInput[] = [];
    const executorCalls: unknown[] = [];
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat(input) {
        providerInputs.push(input);
        if (providerInputs.length === 1) {
          yield { type: "tool_call", toolCall };
          return;
        }
        yield "final answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_tool_resume",
        messages: [{ role: "user", content: "calculate" }],
        modelToolExecutor: async (requestedToolCall) => {
          executorCalls.push(requestedToolCall);
          return { content: JSON.stringify({ result: 4 }) };
        },
      }),
    );

    expect(providerInputs).toHaveLength(2);
    expect(executorCalls).toEqual([toolCall]);
    expect(providerInputs[1]?.messages).toEqual([
      { role: "user", content: "calculate" },
      { role: "assistant", content: "", toolCalls: [toolCall] },
      {
        role: "tool",
        content: JSON.stringify({ result: 4 }),
        name: "tool_calculator",
        toolCallId: "raw-provider-tool-call-secret",
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "tool.requested",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(events.at(-2)?.data).toEqual({
      role: "assistant",
      content: "final answer",
    });
    expect(JSON.stringify(events)).not.toContain("2 + 2");
    expect(JSON.stringify(events)).not.toContain(
      "raw-provider-tool-call-secret",
    );
    expect(JSON.stringify(events)).not.toContain(JSON.stringify({ result: 4 }));
  });

  it("executes batched model-requested tools before resuming the provider stream", async () => {
    const firstToolCall = normalizeProviderToolCall({
      id: "raw-provider-batch-call-1",
      type: "function",
      function: {
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: "2 + 2" }),
      },
    });
    const secondToolCall = normalizeProviderToolCall({
      id: "raw-provider-batch-call-2",
      type: "function",
      function: {
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: "3 + 3" }),
      },
    });
    if (firstToolCall === undefined || secondToolCall === undefined)
      throw new Error("Expected normalized tool calls");

    const toolCalls = [firstToolCall, secondToolCall];
    const providerInputs: StreamChatInput[] = [];
    const executorCalls: unknown[] = [];
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat(input) {
        providerInputs.push(input);
        if (providerInputs.length === 1) {
          yield {
            type: "tool_call",
            toolCall: firstToolCall,
            toolCalls,
          };
          return;
        }
        yield "batched final answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_tool_batch_resume",
        messages: [{ role: "user", content: "calculate twice" }],
        modelToolExecutor: async (requestedToolCall) => {
          executorCalls.push(requestedToolCall);
          const expression = requestedToolCall.arguments.expression;
          return {
            content: JSON.stringify({
              result: expression === "2 + 2" ? 4 : 6,
            }),
          };
        },
      }),
    );

    expect(providerInputs).toHaveLength(2);
    expect(executorCalls).toEqual(toolCalls);
    expect(providerInputs[1]?.messages).toEqual([
      { role: "user", content: "calculate twice" },
      { role: "assistant", content: "", toolCalls },
      {
        role: "tool",
        content: JSON.stringify({ result: 4 }),
        name: "tool_calculator",
        toolCallId: "raw-provider-batch-call-1",
      },
      {
        role: "tool",
        content: JSON.stringify({ result: 6 }),
        name: "tool_calculator",
        toolCallId: "raw-provider-batch-call-2",
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "tool.requested",
      "tool.requested",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(JSON.stringify(events)).not.toContain("2 + 2");
    expect(JSON.stringify(events)).not.toContain("3 + 3");
    expect(JSON.stringify(events)).not.toContain("raw-provider-batch-call-1");
    expect(JSON.stringify(events)).not.toContain("raw-provider-batch-call-2");
  });

  it("fails closed when model-requested tools exceed the runtime limit", async () => {
    const toolCall = normalizeProviderToolCall({
      id: "raw-provider-tool-call-limit-secret",
      type: "function",
      function: {
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: "1 + 1" }),
      },
    });
    if (toolCall === undefined)
      throw new Error("Expected normalized tool call");

    let executions = 0;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        yield { type: "tool_call", toolCall };
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_tool_limit",
        messages: [{ role: "user", content: "loop" }],
        maxModelToolCalls: 1,
        modelToolExecutor: async () => {
          executions += 1;
          return { content: JSON.stringify({ result: 2 }) };
        },
      }),
    );

    expect(executions).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "tool.requested",
      "tool.requested",
      "run.failed",
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      errorCode: "model_tool_call_limit_exceeded",
      toolName: "tool_calculator",
    });
    expect(JSON.stringify(events)).not.toContain(
      "raw-provider-tool-call-limit-secret",
    );
    expect(JSON.stringify(events)).not.toContain("1 + 1");
  });

  it("suspends with approval request IDs for approval-gated model tool calls", async () => {
    const toolCall = normalizeProviderToolCall({
      id: "raw-provider-tool-approval-secret",
      type: "function",
      function: {
        name: "tool_datetime",
        arguments: JSON.stringify({ timeZone: "UTC" }),
      },
    });
    if (toolCall === undefined)
      throw new Error("Expected normalized tool call");

    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        yield { type: "tool_call", toolCall };
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_tool_approval_required",
        messages: [{ role: "user", content: "date" }],
        modelToolExecutor: async () => {
          throw {
            code: "tool_approval_required",
            details: { approvalRequestId: "tool_call_approval_required_1" },
            message: "raw approval failure details",
          };
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "tool.requested",
      "run.waiting_tool_approval",
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      approvalRequestId: "tool_call_approval_required_1",
      errorCode: "tool_approval_required",
      toolName: "tool_datetime",
    });
    expect(JSON.stringify(events)).not.toContain("UTC");
    expect(JSON.stringify(events)).not.toContain(
      "raw-provider-tool-approval-secret",
    );
    expect(JSON.stringify(events)).not.toContain(
      "raw approval failure details",
    );
  });

  it("retries a provider stream failure before content is emitted", async () => {
    const rawPrompt = "raw-provider-retry-prompt-secret";
    let calls = 0;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        calls += 1;
        if (calls === 1) {
          throw new Error(`temporary provider failure for ${rawPrompt}`);
        }
        yield "retried";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_retry",
        messages: [{ role: "user", content: rawPrompt }],
        providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
      }),
    );

    expect(calls).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(events.at(-1)?.data).toEqual({ providerRetryAttempts: 1 });
    expect(JSON.stringify(events)).not.toContain(rawPrompt);
  });

  it("does not retry after provider content has been emitted", async () => {
    const rawText = "raw-partial-provider-secret";
    let calls = 0;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        calls += 1;
        yield "partial";
        throw new Error(`provider failed after partial output ${rawText}`);
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_no_retry_after_output",
        messages: [{ role: "user", content: "do not duplicate output" }],
        providerRetryPolicy: { maxRetries: 2, backoffMs: 0 },
      }),
    );

    expect(calls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.delta",
      "run.failed",
    ]);
    expect(events.at(-1)?.data).toEqual({
      errorCode: "provider_stream_error",
    });
    expect(JSON.stringify(events)).not.toContain(rawText);
  });

  it("opens a provider circuit and fails fast without calling the adapter", async () => {
    let calls = 0;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        calls += 1;
        throw new Error("provider unavailable");
      },
    };
    const breaker = new ProviderCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 60_000,
    });

    const first = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_circuit_first",
        messages: [{ role: "user", content: "first failure" }],
        providerCircuitBreaker: breaker,
      }),
    );
    const second = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_circuit_second",
        messages: [{ role: "user", content: "second failure" }],
        providerCircuitBreaker: breaker,
      }),
    );
    const third = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_circuit_open",
        messages: [{ role: "user", content: "fast fail" }],
        providerCircuitBreaker: breaker,
      }),
    );

    expect(calls).toBe(2);
    expect(first.at(-1)?.data).toEqual({ errorCode: "provider_stream_error" });
    expect(second.at(-1)?.data).toEqual({
      errorCode: "provider_stream_error",
      providerCircuit: { state: "open", consecutiveFailures: 2 },
    });
    expect(third.at(-1)?.data).toEqual({
      errorCode: "provider_circuit_open",
      providerCircuit: { state: "open", consecutiveFailures: 2 },
    });
  });

  it("falls back after a pre-output provider failure", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        primaryCalls += 1;
        throw new Error("primary unavailable");
      },
    };
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "ollama",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [fallbackModel];
      },
      async *streamChat() {
        fallbackCalls += 1;
        yield "fallback answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider,
        model,
        runId: "run_provider_fallback",
        messages: [{ role: "user", content: "use fallback" }],
        providerFallback: {
          adapter: fallbackAdapter,
          provider: fallbackProvider,
          model: fallbackModel,
        },
      }),
    );

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(events.at(-1)?.data).toEqual({
      providerFallback: {
        fromModelId: model.id,
        fromProviderId: provider.id,
        reason: "provider_stream_error",
        toModelId: fallbackModel.id,
        toProviderId: fallbackProvider.id,
      },
    });
  });

  it("uses the fallback provider scoped API key after primary failure", async () => {
    let fallbackInput: StreamChatInput | undefined;
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        throw new Error("primary unavailable");
      },
    };
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "ollama",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [fallbackModel];
      },
      async *streamChat(input) {
        fallbackInput = input;
        yield "fallback answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider,
        model,
        runId: "run_provider_fallback_scoped_key",
        messages: [{ role: "user", content: "use fallback credentials" }],
        providerApiKeys: {
          [provider.id]: "primary-provider-key",
          [fallbackProvider.id]: "fallback-provider-key",
        },
        providerFallback: {
          adapter: fallbackAdapter,
          provider: fallbackProvider,
          model: fallbackModel,
        },
      }),
    );

    expect(events.at(-1)?.type).toBe("run.completed");
    expect(fallbackInput?.apiKey).toBe("fallback-provider-key");
  });

  it("does not fall back after provider content has been emitted", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        primaryCalls += 1;
        yield "partial";
        throw new Error("primary failed late");
      },
    };
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "ollama",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [fallbackModel];
      },
      async *streamChat() {
        fallbackCalls += 1;
        yield "fallback answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider,
        model,
        runId: "run_provider_no_late_fallback",
        messages: [{ role: "user", content: "do not fallback late" }],
        providerFallback: {
          adapter: fallbackAdapter,
          provider: fallbackProvider,
          model: fallbackModel,
        },
      }),
    );

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
    expect(events.at(-1)?.data).toEqual({
      errorCode: "provider_stream_error",
    });
  });

  it("uses fallback without calling a kill-switched provider", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        primaryCalls += 1;
        yield "primary should not run";
      },
    };
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "ollama",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [fallbackModel];
      },
      async *streamChat() {
        fallbackCalls += 1;
        yield "fallback answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider,
        model,
        runId: "run_provider_disabled_fallback",
        messages: [{ role: "user", content: "provider disabled" }],
        providerDisabled: true,
        providerFallback: {
          adapter: fallbackAdapter,
          provider: fallbackProvider,
          model: fallbackModel,
        },
      }),
    );

    expect(primaryCalls).toBe(0);
    expect(fallbackCalls).toBe(1);
    expect(events.at(-1)?.data).toEqual({
      providerFallback: {
        fromModelId: model.id,
        fromProviderId: provider.id,
        reason: "provider_disabled",
        toModelId: fallbackModel.id,
        toProviderId: fallbackProvider.id,
      },
    });
  });
});

async function collectRunEvents(
  events: AsyncIterable<RunEvent>,
): Promise<RunEvent[]> {
  const collected: RunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const provider: ProviderInstance = {
  id: "provider_test",
  orgId: "org_default",
  type: "openai-compatible",
  name: "Provider Test",
  baseUrl: "https://provider.test",
  enabled: true,
  capabilities: {
    streaming: true,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    modalities: ["text"],
    deployment: {
      mode: "hosted-api",
      networkAccess: "external-http",
      credentialRequired: true,
    },
  },
};

const model: BaseModel = {
  id: "model_test",
  providerId: provider.id,
  name: "test-model",
  displayName: "Test Model",
  enabled: true,
  capabilities: provider.capabilities,
  contextWindow: 8192,
};

const fallbackProvider: ProviderInstance = {
  id: "provider_fallback",
  orgId: "org_default",
  type: "ollama",
  name: "Fallback Provider",
  baseUrl: "http://ollama.test",
  enabled: true,
  capabilities: {
    streaming: true,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    modalities: ["text"],
    deployment: {
      mode: "local-runtime",
      networkAccess: "local-http",
      credentialRequired: false,
    },
  },
};

const fallbackModel: BaseModel = {
  id: "model_fallback",
  providerId: fallbackProvider.id,
  name: "fallback",
  displayName: "Fallback",
  enabled: true,
  capabilities: fallbackProvider.capabilities,
  contextWindow: 8192,
};
