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
  it("merges segmented provider token details into the terminal usage snapshot", async () => {
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        yield {
          type: "usage" as const,
          usage: {
            inputTokens: 120,
            cachedInputTokens: 80,
            source: "untrusted-upstream-source",
          },
        };
        yield "answer";
        yield {
          type: "usage" as const,
          usage: {
            outputTokens: 30,
            reasoningTokens: 20,
            totalTokens: 150,
            source: "sk-private-usage-source-sentinel",
          },
        };
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_segmented_usage",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      data: {
        usage: {
          inputTokens: 120,
          cachedInputTokens: 80,
          outputTokens: 30,
          reasoningTokens: 20,
          totalTokens: 150,
          source: "openai-compatible",
        },
      },
    });
  });

  // Sampling pinned on a managed model version reached the executor and stopped there for a long
  // while: StreamChatInput had no field for it, so temperature was stored, versioned and audited
  // while every request went out with the provider's own default.
  it("hands the pinned sampling to the adapter, and again after a retry", async () => {
    const seen: (StreamChatInput["sampling"] | undefined)[] = [];
    const model = {
      id: "model_s",
      providerId: "provider_s",
      name: "m",
    } as BaseModel;
    const provider = { id: "provider_s", name: "p" } as ProviderInstance;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat(input) {
        seen.push(input.sampling);
        if (seen.length === 1) throw new Error("transient");
        yield "ok";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_sampling",
        messages: [{ role: "user", content: "hi" }],
        sampling: { temperature: 0.2, maxTokens: 512 },
        providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
      }),
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ temperature: 0.2, maxTokens: 512 });
    expect(seen[1]).toEqual({ temperature: 0.2, maxTokens: 512 });
    expect(events[0]).toMatchObject({
      type: "run.started",
      data: {
        parameterResolution: {
          requested: {
            sampling: { temperature: 0.2, maxTokens: 512 },
          },
          effective: {
            sampling: { temperature: 0.2, maxTokens: 512 },
          },
          omissions: [],
        },
      },
    });
  });

  it("re-resolves governance before dispatch and emits no answer after a new deny", async () => {
    let adapterCalls = 0;
    let resolutions = 0;
    const reasoningProvider: ProviderInstance = {
      ...provider,
      capabilities: { ...provider.capabilities, reasoning: true },
    };
    const reasoningModel: BaseModel = {
      ...model,
      capabilities: reasoningProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat() {
        adapterCalls += 1;
        throw new Error("retryable network failure");
      },
    };
    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_reasoning_revoked",
        messages: [{ role: "user", content: "safe request" }],
        reasoningPolicy: {
          runRequest: { schemaVersion: 1, mode: "auto", effort: "low" },
        },
        reasoningPolicyResolver: async () => {
          resolutions += 1;
          return {
            organizationMaximum:
              resolutions <= 2
                ? { schemaVersion: 1, mode: "auto", effort: "high" }
                : { schemaVersion: 1, mode: "off" },
            runRequest: { schemaVersion: 1, mode: "auto", effort: "low" },
          };
        },
        providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
      }),
    );

    expect(resolutions).toBe(3);
    expect(adapterCalls).toBe(1);
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "run.failed" });
    expect(JSON.stringify(events)).not.toContain("must-not-be-emitted");
  });

  it("rejects an invalid tool set before invoking the adapter", async () => {
    let adapterCalls = 0;
    let adapterTools: StreamChatInput["tools"];
    const toolProvider: ProviderInstance = {
      ...provider,
      capabilities: { ...provider.capabilities, toolCalling: true },
    };
    const toolModel: BaseModel = {
      ...model,
      capabilities: toolProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [toolModel];
      },
      async *streamChat(input) {
        adapterCalls += 1;
        adapterTools = input.tools;
        yield "ok";
      },
    };
    const stream = streamRunEvents({
      adapter,
      provider: toolProvider,
      model: toolModel,
      runId: "run_invalid_tool_set",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "valid_tool",
          description: "Valid tool.",
          parameters: { type: "object" },
        },
        {
          name: "invalid.tool",
          description: "Invalid tool.",
          parameters: { type: "object" },
        },
      ],
    })[Symbol.asyncIterator]();

    const failed = await stream.next();
    expect(adapterCalls).toBe(0);
    expect(failed.value).toMatchObject({
      type: "run.failed",
      data: {
        errorCode: "provider_invalid_request_or_capability",
        errorType: "invalid_request_or_capability",
      },
    });
    while (!(await stream.next()).done) {
      // The rejected stream must already be terminal.
    }
    expect(adapterCalls).toBe(0);
    expect(adapterTools).toBeUndefined();
    expect(JSON.stringify(failed.value)).not.toContain("invalid.tool");
  });

  it("emits explicitly retained provider-safe summary events separately from the answer", async () => {
    const promptSentinel = "private-summary-prompt-sentinel";
    let adapterCalls = 0;
    const reasoningProvider: ProviderInstance = {
      ...provider,
      type: "openai-responses-compatible",
      capabilities: { ...provider.capabilities, reasoning: true },
    };
    const reasoningModel: BaseModel = {
      ...model,
      capabilities: reasoningProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat(input) {
        adapterCalls += 1;
        expect(input.reasoning).toEqual({
          effort: "high",
          summary: "detailed",
        });
        yield { type: "reasoning_summary" as const, text: "Safe summary." };
        yield {
          type: "usage" as const,
          usage: { outputTokens: 20, reasoningTokens: 12 },
        };
        yield "public answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_summary_policy_rejected",
        messages: [{ role: "user", content: promptSentinel }],
        reasoningPolicy: {
          runRequest: {
            schemaVersion: 1,
            mode: "summary",
            effort: "high",
            summaryDetail: "detailed",
            retainSummary: true,
          },
        },
      }),
    );

    expect(adapterCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.delta",
      "reasoning.summary.delta",
      "reasoning.summary.completed",
      "message.completed",
      "run.completed",
    ]);
    expect(events[3]).toMatchObject({
      type: "reasoning.summary.delta",
      data: {
        classification: "provider_safe_summary",
        text: "Safe summary.",
      },
    });
    expect(events[4]).toMatchObject({
      type: "reasoning.summary.completed",
      data: {
        classification: "provider_safe_summary",
        status: "completed",
        characterCount: 13,
        reasoningTokens: 12,
      },
    });
    expect(JSON.stringify(events)).not.toContain(promptSentinel);
    expect(
      events.find((event) => event.type === "message.completed")?.data,
    ).toEqual({
      role: "assistant",
      content: "public answer",
    });
  });

  it("rejects an unenforceable run reasoning budget before provider side effects", async () => {
    let adapterCalls = 0;
    const reasoningProvider: ProviderInstance = {
      ...provider,
      capabilities: { ...provider.capabilities, reasoning: true },
    };
    const reasoningModel: BaseModel = {
      ...model,
      capabilities: reasoningProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat() {
        adapterCalls += 1;
        yield "must not answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_reasoning_budget_rejected",
        messages: [{ role: "user", content: "bounded reasoning" }],
        reasoningPolicy: {
          runRequest: {
            schemaVersion: 1,
            mode: "auto",
            effort: "medium",
            maxReasoningTokens: 2_000,
          },
        },
      }),
    );

    expect(adapterCalls).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run.failed",
      data: { errorCode: "provider_invalid_request_or_capability" },
    });
    expect(JSON.stringify(events)).not.toContain("must not answer");
  });

  it("maps a supported automatic reasoning effort with safe policy evidence", async () => {
    let seenReasoning: StreamChatInput["reasoning"];
    const reasoningProvider: ProviderInstance = {
      ...provider,
      type: "openai-responses-compatible",
      capabilities: { ...provider.capabilities, reasoning: true },
    };
    const reasoningModel: BaseModel = {
      ...model,
      capabilities: reasoningProvider.capabilities,
    };
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat(input) {
        seenReasoning = input.reasoning;
        yield "ok";
      },
    };
    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_auto_reasoning_policy",
        messages: [{ role: "user", content: "hello" }],
        reasoningPolicy: {
          agentDefault: {
            schemaVersion: 1,
            mode: "auto",
            effort: "medium",
          },
        },
      }),
    );

    expect(seenReasoning).toEqual({ effort: "medium" });
    expect(events[0]).toMatchObject({
      type: "run.started",
      data: {
        parameterResolution: {
          reasoningPolicy: {
            source: "agent_default",
            requested: { mode: "auto", effort: "medium" },
            effective: { mode: "auto", effort: "medium" },
            rejected: false,
          },
        },
      },
    });
  });

  it("re-resolves parameters against fallback capabilities without leaking schemas or tool names", async () => {
    const primaryProvider: ProviderInstance = {
      ...provider,
      type: "openai-responses-compatible",
      capabilities: {
        ...provider.capabilities,
        reasoning: true,
        structuredJson: true,
        temperature: true,
        toolCalling: true,
      },
    };
    const primaryModel: BaseModel = {
      ...model,
      providerId: primaryProvider.id,
      capabilities: primaryProvider.capabilities,
    };
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [primaryModel];
      },
      async *streamChat() {
        throw { errorCode: "provider_unavailable" };
      },
    };
    const fallbackSeen: StreamChatInput[] = [];
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "ollama",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [fallbackModel];
      },
      async *streamChat(input) {
        fallbackSeen.push(input);
        yield "fallback";
      },
    };
    const schemaSentinel = "private-schema-sentinel";
    const toolNameSentinel = "private_tool_sentinel";
    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider: primaryProvider,
        model: primaryModel,
        runId: "run_parameter_fallback",
        messages: [{ role: "user", content: "fall back" }],
        sampling: { temperature: 0.3, maxTokens: 256 },
        reasoning: { effort: "high", summary: "concise" },
        structuredOutput: {
          type: "json_schema",
          name: "private_schema",
          schema: { type: "object", description: schemaSentinel },
        },
        tools: [
          {
            name: toolNameSentinel,
            description: "Synthetic tool.",
            parameters: { type: "object" },
          },
        ],
        providerFallback: {
          adapter: fallbackAdapter,
          provider: fallbackProvider,
          model: fallbackModel,
        },
      }),
    );

    expect(fallbackSeen).toHaveLength(1);
    expect(fallbackSeen[0]?.sampling).toEqual({
      temperature: 0.3,
      maxTokens: 256,
    });
    expect(fallbackSeen[0]?.reasoning).toBeUndefined();
    expect(fallbackSeen[0]?.structuredOutput).toBeUndefined();
    expect(fallbackSeen[0]?.tools).toBeUndefined();
    expect(events[0]).toMatchObject({
      data: {
        parameterResolution: {
          requested: {
            reasoning: { effort: "high", summary: "concise" },
            sampling: { temperature: 0.3, maxTokens: 256 },
            structuredOutput: { type: "json_schema" },
            tools: { count: 1 },
          },
          effective: {
            reasoning: { effort: "high", summary: "concise" },
            sampling: { temperature: 0.3, maxTokens: 256 },
            structuredOutput: { type: "json_schema" },
            tools: { count: 1 },
          },
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      data: {
        providerFallback: {
          parameterResolution: {
            requested: {
              reasoning: { effort: "high", summary: "concise" },
              sampling: { temperature: 0.3, maxTokens: 256 },
              structuredOutput: { type: "json_schema" },
              tools: { count: 1 },
            },
            effective: {
              sampling: { temperature: 0.3, maxTokens: 256 },
            },
            omissions: [
              {
                parameter: "reasoning",
                reason: "unsupported_by_model_or_provider",
              },
              {
                parameter: "structuredOutput",
                reason: "unsupported_by_dialect",
              },
              {
                parameter: "tools",
                reason: "unsupported_by_model_or_provider",
              },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain(schemaSentinel);
    expect(JSON.stringify(events)).not.toContain(toolNameSentinel);
  });

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
    const reasoningProvider = responsesReasoningProvider(provider);
    const reasoningModel = responsesReasoningModel(model, reasoningProvider);
    const summarySentinel = "cancelled-safe-summary-sentinel";
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat() {
        yield { type: "reasoning_summary" as const, text: summarySentinel };
        controller.abort();
        yield "provider text after cancellation";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_provider_cancelled",
        messages: [{ role: "user", content: "cancel this run" }],
        signal: controller.signal,
        reasoningPolicy: retainedSummaryPolicy,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "reasoning.summary.completed",
      "run.cancelled",
    ]);
    expect(events[2]?.data).toMatchObject({
      classification: "hidden_reasoning_omitted",
      status: "discarded",
    });
    expect(JSON.stringify(events)).not.toContain(summarySentinel);
    expect(JSON.stringify(events)).not.toContain(
      "provider text after cancellation",
    );
  });

  it("fails a stalled provider stream without emitting delayed provider text", async () => {
    const rawText = "provider text after idle timeout";
    const summarySentinel = "timed-out-safe-summary-sentinel";
    const reasoningProvider = responsesReasoningProvider(provider);
    const reasoningModel = responsesReasoningModel(model, reasoningProvider);
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat() {
        yield { type: "reasoning_summary" as const, text: summarySentinel };
        await sleep(30);
        yield rawText;
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_provider_timeout",
        messages: [{ role: "user", content: "time out this run" }],
        providerTimeoutMs: 5,
        reasoningPolicy: retainedSummaryPolicy,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "reasoning.summary.completed",
      "run.failed",
    ]);
    expect(events[2]?.data).toMatchObject({
      classification: "hidden_reasoning_omitted",
      status: "discarded",
    });
    expect(events.at(-1)?.data).toEqual({
      errorCode: "provider_timeout",
      errorType: "timeout",
    });
    expect(JSON.stringify(events)).not.toContain(rawText);
    expect(JSON.stringify(events)).not.toContain(summarySentinel);
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

  it("drops tools for a model without native tool-calling capability", async () => {
    let seenInput: StreamChatInput | undefined;
    const adapter: ModelProviderAdapter = {
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat(input) {
        seenInput = input;
        yield "hello";
      },
    };
    await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: {
          ...provider,
          capabilities: { ...provider.capabilities, toolCalling: true },
        },
        model,
        runId: "run_toolless_model",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "tool_calculator",
            description: "Calculate",
            parameters: { type: "object" },
          },
        ],
      }),
    );
    expect(seenInput?.tools).toBeUndefined();
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
    const requestedData = requested?.data as
      | { providerCallIdHash?: string }
      | undefined;
    expect(requestedData?.providerCallIdHash).toMatch(/^[a-f0-9]{64}$/);
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
    const reasoningProvider = responsesReasoningProvider({
      ...provider,
      capabilities: { ...provider.capabilities, toolCalling: true },
    });
    const reasoningModel = responsesReasoningModel(model, reasoningProvider);
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat(input) {
        providerInputs.push(input);
        if (providerInputs.length === 1) {
          yield {
            type: "reasoning_summary" as const,
            text: "Choose calculator.",
          };
          yield { type: "tool_call", toolCall };
          return;
        }
        yield {
          type: "reasoning_summary" as const,
          text: "Computed result.",
        };
        yield "final answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_provider_tool_resume",
        messages: [{ role: "user", content: "calculate" }],
        modelToolExecutor: async (requestedToolCall) => {
          executorCalls.push(requestedToolCall);
          return { content: JSON.stringify({ result: 4 }) };
        },
        reasoningPolicy: retainedSummaryPolicy,
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
      "reasoning.summary.delta",
      "reasoning.summary.completed",
      "tool.requested",
      "message.started",
      "message.delta",
      "reasoning.summary.delta",
      "reasoning.summary.completed",
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
          yield {
            type: "usage" as const,
            usage: { outputTokens: 9, reasoningTokens: 8 },
          };
          throw new Error(`temporary provider failure for ${rawPrompt}`);
        }
        yield "retried";
        yield {
          type: "usage" as const,
          usage: {
            outputTokens: 3,
            reasoningTokens: 2,
            source: "sk-private-retry-source-sentinel",
          },
        };
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
    expect(events.at(-1)?.data).toEqual({
      providerRetryAttempts: 1,
      usage: {
        outputTokens: 12,
        reasoningTokens: 10,
        source: "openai-compatible",
      },
      usageSegments: [
        {
          modelId: model.id,
          providerId: provider.id,
          usage: {
            outputTokens: 9,
            reasoningTokens: 8,
            source: "openai-compatible",
          },
        },
        {
          modelId: model.id,
          providerId: provider.id,
          usage: {
            outputTokens: 3,
            reasoningTokens: 2,
            source: "openai-compatible",
          },
        },
      ],
    });
    expect(JSON.stringify(events)).not.toContain(rawPrompt);
    expect(JSON.stringify(events)).not.toContain(
      "sk-private-retry-source-sentinel",
    );
  });

  it.each([
    ["provider_rate_limited", "rate_limit", 2],
    [
      "provider_invalid_request_or_capability",
      "invalid_request_or_capability",
      1,
    ],
  ] as const)(
    "uses normalized retry classification for %s",
    async (errorCode, errorType, expectedCalls) => {
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
          if (calls === 1) throw { errorCode, errorType };
          yield "retried";
        },
      };

      const events = await collectRunEvents(
        streamRunEvents({
          adapter,
          provider,
          model,
          runId: `run_normalized_${errorType}`,
          messages: [{ role: "user", content: "retry if safe" }],
          providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
        }),
      );

      expect(calls).toBe(expectedCalls);
      expect(events.at(-1)?.type).toBe(
        expectedCalls === 2 ? "run.completed" : "run.failed",
      );
      if (expectedCalls === 1) {
        expect(events.at(-1)?.data).toMatchObject({ errorCode, errorType });
      }
    },
  );

  it("drops raw reasoning text without spending the retry budget", async () => {
    const rawSentinel = "raw-private-trace-secret";
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
          yield { type: "reasoning" as const, text: rawSentinel };
          throw new Error("temporary provider failure while thinking");
        }
        yield { type: "reasoning" as const, text: `${rawSentinel}-retry` };
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId: "run_provider_reasoning",
        messages: [{ role: "user", content: "think first" }],
        providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
      }),
    );

    expect(calls).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "message.reasoning",
      "message.started",
      "message.reasoning",
      "message.completed",
      "run.completed",
    ]);
    expect(
      events
        .filter((event) => event.type === "message.reasoning")
        .map((event) => event.data),
    ).toEqual([
      { classification: "hidden_reasoning_omitted" },
      { classification: "hidden_reasoning_omitted" },
    ]);
    expect(JSON.stringify(events)).not.toContain(rawSentinel);
    expect(
      events.find((event) => event.type === "message.completed")?.data,
    ).toEqual({ role: "assistant", content: "" });
  });

  it("discards a retained summary from an abandoned retry attempt", async () => {
    const abandonedSentinel = "abandoned-retry-summary-sentinel";
    const reasoningProvider = responsesReasoningProvider(provider);
    const reasoningModel = responsesReasoningModel(model, reasoningProvider);
    let calls = 0;
    const adapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [reasoningModel];
      },
      async *streamChat() {
        calls += 1;
        if (calls === 1) {
          yield {
            type: "reasoning_summary" as const,
            text: abandonedSentinel,
          };
          throw new Error("retry this attempt");
        }
        yield { type: "reasoning_summary" as const, text: "Final summary." };
        yield "answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider: reasoningProvider,
        model: reasoningModel,
        runId: "run_reasoning_summary_retry",
        messages: [{ role: "user", content: "retry safely" }],
        providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
        reasoningPolicy: retainedSummaryPolicy,
      }),
    );

    expect(calls).toBe(2);
    expect(events[2]).toMatchObject({
      type: "reasoning.summary.completed",
      data: {
        classification: "hidden_reasoning_omitted",
        status: "discarded",
      },
    });
    expect(JSON.stringify(events)).not.toContain(abandonedSentinel);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "reasoning.summary.delta",
        data: {
          classification: "provider_safe_summary",
          text: "Final summary.",
        },
      }),
    );
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
        yield {
          type: "usage" as const,
          usage: { outputTokens: 5, reasoningTokens: 4 },
        };
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
        yield {
          type: "usage" as const,
          usage: {
            outputTokens: 3,
            reasoningTokens: 2,
            source: "private-fallback-source-sentinel",
          },
        };
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
      usage: { outputTokens: 8, reasoningTokens: 6 },
      usageSegments: [
        {
          modelId: model.id,
          providerId: provider.id,
          usage: {
            outputTokens: 5,
            reasoningTokens: 4,
            source: "openai-compatible",
          },
        },
        {
          modelId: fallbackModel.id,
          providerId: fallbackProvider.id,
          usage: {
            outputTokens: 3,
            reasoningTokens: 2,
            source: "ollama",
          },
        },
      ],
      providerFallback: {
        fromModelId: model.id,
        fromProviderId: provider.id,
        reason: "provider_stream_error",
        toModelId: fallbackModel.id,
        toProviderId: fallbackProvider.id,
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      "private-fallback-source-sentinel",
    );
  });

  it("restarts a provider-safe summary when its provider is abandoned", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primaryProvider = responsesReasoningProvider(provider);
    const primaryModel = responsesReasoningModel(model, primaryProvider);
    const secondaryProvider = responsesReasoningProvider(fallbackProvider);
    const secondaryModel = responsesReasoningModel(
      fallbackModel,
      secondaryProvider,
    );
    const primaryAdapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [primaryModel];
      },
      async *streamChat() {
        primaryCalls += 1;
        yield {
          type: "reasoning_summary" as const,
          text: "Primary summary.",
        };
        throw new Error("primary unavailable mid-thought");
      },
    };
    const fallbackAdapter: ModelProviderAdapter = {
      kind: "openai-responses-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [secondaryModel];
      },
      async *streamChat() {
        fallbackCalls += 1;
        yield {
          type: "reasoning_summary" as const,
          text: "Fallback summary.",
        };
        yield "fallback answer";
      },
    };

    const events = await collectRunEvents(
      streamRunEvents({
        adapter: primaryAdapter,
        provider: primaryProvider,
        model: primaryModel,
        runId: "run_provider_fallback_reasoning",
        messages: [{ role: "user", content: "think, then fall back" }],
        providerFallback: {
          adapter: fallbackAdapter,
          provider: secondaryProvider,
          model: secondaryModel,
        },
        reasoningPolicy: retainedSummaryPolicy,
      }),
    );

    // Reasoning still does not spend the fallback budget: the primary thought out loud and the
    // fallback ran anyway, exactly once.
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.started",
      "reasoning.summary.completed",
      "message.started",
      "message.delta",
      "reasoning.summary.delta",
      "reasoning.summary.completed",
      "message.completed",
      "run.completed",
    ]);
    expect(events[2]?.data).toMatchObject({
      classification: "hidden_reasoning_omitted",
      status: "discarded",
    });
    expect(JSON.stringify(events)).not.toContain("Primary summary.");
    expect(events[5]?.data).toMatchObject({ text: "Fallback summary." });
    expect(events.at(-1)?.data).toMatchObject({
      providerFallback: {
        fromModelId: primaryModel.id,
        fromProviderId: primaryProvider.id,
        reason: "provider_stream_error",
        toModelId: secondaryModel.id,
        toProviderId: secondaryProvider.id,
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

  describe("provider health accounting", () => {
    const failingAdapter = (failure: unknown): ModelProviderAdapter => ({
      kind: "openai-compatible",
      async health() {
        return { ok: true, message: "ok" };
      },
      async listModels() {
        return [model];
      },
      async *streamChat() {
        throw failure;
      },
    });

    async function failTwice(
      failure: unknown,
    ): Promise<{ breaker: ProviderCircuitBreaker; events: RunEvent[] }> {
      const breaker = new ProviderCircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 60_000,
      });
      let events: RunEvent[] = [];
      for (const runId of ["run_health_first", "run_health_second"]) {
        events = await collectRunEvents(
          streamRunEvents({
            adapter: failingAdapter(failure),
            provider,
            model,
            runId,
            messages: [{ role: "user", content: "probe" }],
            providerCircuitBreaker: breaker,
            providerRetryPolicy: { maxRetries: 0, backoffMs: 0 },
          }),
        );
      }
      return { breaker, events };
    }

    it.each([["http_400"], ["http_413"], ["http_422"]])(
      "does not count a %s payload rejection against provider health",
      async (errorType) => {
        const { breaker, events } = await failTwice({
          errorCode: "provider_http_error",
          errorType,
        });

        // A malformed payload is this run's fault, not the provider's: the breaker must stay closed
        // so one tenant's oversized request cannot open the circuit for every tenant on that provider.
        expect(breaker.snapshot(provider.id)).toEqual({
          state: "closed",
          consecutiveFailures: 0,
        });
        // The suppressed path still hands a valid snapshot down; a closed circuit is simply not serialized.
        expect(events.at(-1)?.data).toEqual({
          errorCode: "provider_http_error",
          errorType,
        });
      },
    );

    it.each([["http_401"], ["http_403"], ["http_429"], ["http_500"]])(
      "counts a %s failure against provider health",
      async (errorType) => {
        const { breaker, events } = await failTwice({
          errorCode: "provider_http_error",
          errorType,
        });

        // A revoked key or an overloaded provider is exactly what the breaker exists to back off from.
        expect(breaker.snapshot(provider.id)).toEqual({
          state: "open",
          consecutiveFailures: 2,
        });
        expect(events.at(-1)?.data).toMatchObject({
          providerCircuit: { state: "open", consecutiveFailures: 2 },
        });
      },
    );

    it("counts a stream error with no errorType against provider health", async () => {
      const { breaker } = await failTwice(new Error("provider unavailable"));

      expect(breaker.snapshot(provider.id)).toEqual({
        state: "open",
        consecutiveFailures: 2,
      });
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

const retainedSummaryPolicy = {
  runRequest: {
    schemaVersion: 1 as const,
    mode: "summary" as const,
    retainSummary: true,
  },
};

function responsesReasoningProvider(value: ProviderInstance): ProviderInstance {
  return {
    ...value,
    type: "openai-responses-compatible",
    capabilities: { ...value.capabilities, reasoning: true },
  };
}

function responsesReasoningModel(
  value: BaseModel,
  reasoningProvider: ProviderInstance,
): BaseModel {
  return {
    ...value,
    providerId: reasoningProvider.id,
    capabilities: reasoningProvider.capabilities,
  };
}
