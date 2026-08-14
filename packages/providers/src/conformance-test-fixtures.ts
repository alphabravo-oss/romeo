import { defaultProviderCapabilities } from "./capabilities";
import type { ProviderAdapterConformanceFixture } from "./conformance-kit";
import { PROVIDER_CONFORMANCE_SENTINELS } from "./conformance-kit";
import { getProviderDialect } from "./registry";
import type {
  BaseModel,
  ProviderInstance,
  ProviderKind,
  ProviderTokenUsage,
} from "./types";

type ProtocolFixture = Omit<ProviderAdapterConformanceFixture, "dialect">;

const usage = {
  anthropic: {
    inputTokens: 3,
    cachedInputTokens: 2,
    outputTokens: 4,
    source: "anthropic",
  },
  ollama: {
    inputTokens: 3,
    outputTokens: 4,
    source: "ollama",
  },
  "openai-compatible": {
    inputTokens: 3,
    outputTokens: 4,
    reasoningTokens: 2,
    totalTokens: 7,
    source: "openai-compatible",
  },
  "openai-responses-compatible": {
    inputTokens: 3,
    outputTokens: 4,
    reasoningTokens: 2,
    totalTokens: 7,
    source: "openai-responses-compatible",
  },
} as const satisfies Record<ProviderKind, ProviderTokenUsage>;

const fixtures = {
  anthropic: fixture("anthropic", {
    goldenStream: {
      createResponse: () =>
        anthropicSse([
          {
            type: "message_start",
            message: {
              id: "msg_conformance",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-conformance",
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 3,
                cache_read_input_tokens: 2,
                output_tokens: 0,
              },
            },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hello " },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Romeo" },
          },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 4 },
          },
        ]),
      text: ["Hello ", "Romeo"],
      usage: usage.anthropic,
    },
    malformedStream: {
      createResponse: () => malformedSse("anthropic"),
    },
    rawReasoningStream: {
      createResponse: () =>
        anthropicSse([
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "thinking_delta",
              thinking: PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
            },
          },
        ]),
    },
    toolCallStream: {
      arguments: { expression: "2 + 2" },
      argumentKeys: ["expression"],
      createResponse: () =>
        anthropicSse([
          {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "toolu_conformance",
              name: "tool_calculator",
              input: {},
            },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: '{"expression":"2 + 2"}',
            },
          },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", usage: { output_tokens: 4 } },
        ]),
      name: "tool_calculator",
    },
    usageEvents: [
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 3,
            cache_read_input_tokens: 2,
            output_tokens: 0,
          },
        },
      },
      { type: "message_delta", usage: { output_tokens: 4 } },
    ],
    usage: usage.anthropic,
  }),
  ollama: fixture("ollama", {
    goldenStream: {
      createResponse: () =>
        jsonLines([
          { message: { role: "assistant", content: "Hello " }, done: false },
          { message: { role: "assistant", content: "Romeo" }, done: false },
          { done: true, prompt_eval_count: 3, eval_count: 4 },
        ]),
      text: ["Hello ", "Romeo"],
      usage: usage.ollama,
    },
    malformedStream: {
      createResponse: () =>
        jsonLines([
          {
            done: false,
            message: { role: 17, content: 42 },
            private: PROVIDER_CONFORMANCE_SENTINELS.malformedChunk,
          },
        ]),
    },
    rawReasoningStream: {
      createResponse: () =>
        jsonLines([
          {
            done: false,
            message: {
              role: "assistant",
              content: "",
              thinking: PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
            },
          },
          { done: true, prompt_eval_count: 0, eval_count: 0 },
        ]),
    },
    toolCallStream: {
      arguments: { expression: "2 + 2" },
      argumentKeys: ["expression"],
      createResponse: () =>
        jsonLines([
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  function: {
                    name: "tool_calculator",
                    arguments: { expression: "2 + 2" },
                  },
                },
              ],
            },
            done: true,
            prompt_eval_count: 3,
            eval_count: 4,
          },
        ]),
      name: "tool_calculator",
    },
    usageEvents: [{ prompt_eval_count: 3, eval_count: 4 }],
    usage: usage.ollama,
  }),
  "openai-compatible": fixture("openai-compatible", {
    goldenStream: {
      createResponse: () =>
        openAiSse([
          { choices: [{ delta: { content: "Hello " } }] },
          { choices: [{ delta: { content: "Romeo" } }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4,
              completion_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 7,
            },
          },
        ]),
      text: ["Hello ", "Romeo"],
      usage: usage["openai-compatible"],
    },
    malformedStream: {
      createResponse: () => malformedSse("openai"),
    },
    rawReasoningStream: {
      createResponse: () =>
        openAiSse([
          {
            choices: [
              {
                delta: {
                  reasoning_content:
                    PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
                },
              },
            ],
          },
          {
            choices: [],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4,
              completion_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 7,
            },
          },
        ]),
    },
    toolCallStream: {
      arguments: { expression: "2 + 2" },
      argumentKeys: ["expression"],
      createResponse: () =>
        openAiSse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_conformance",
                      function: {
                        name: "tool_calculator",
                        arguments: '{"expression"',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: ':"2 + 2"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          {
            choices: [],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4,
              completion_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 7,
            },
          },
        ]),
      name: "tool_calculator",
    },
    usageEvents: [
      {
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          completion_tokens_details: { reasoning_tokens: 2 },
          total_tokens: 7,
        },
      },
    ],
    usage: usage["openai-compatible"],
  }),
  "openai-responses-compatible": fixture("openai-responses-compatible", {
    goldenStream: {
      createResponse: () =>
        openAiSse([
          { type: "response.output_text.delta", delta: "Hello " },
          { type: "response.output_text.delta", delta: "Romeo" },
          {
            type: "response.completed",
            response: {
              usage: {
                input_tokens: 3,
                output_tokens: 4,
                output_tokens_details: { reasoning_tokens: 2 },
                total_tokens: 7,
              },
            },
          },
        ]),
      text: ["Hello ", "Romeo"],
      usage: usage["openai-responses-compatible"],
    },
    malformedStream: {
      createResponse: () => malformedSse("openai"),
    },
    rawReasoningStream: {
      createResponse: () =>
        openAiSse([
          {
            type: "response.reasoning_text.delta",
            delta: PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
          },
        ]),
    },
    toolCallStream: {
      arguments: { expression: "2 + 2" },
      argumentKeys: ["expression"],
      createResponse: () =>
        openAiSse([
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              call_id: "call_conformance",
              name: "tool_calculator",
              arguments: '{"expression":"2 + 2"}',
            },
          },
          {
            type: "response.completed",
            response: {
              usage: {
                input_tokens: 3,
                output_tokens: 4,
                output_tokens_details: { reasoning_tokens: 2 },
                total_tokens: 7,
              },
            },
          },
        ]),
      name: "tool_calculator",
    },
    usageEvents: [
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 3,
            output_tokens: 4,
            output_tokens_details: { reasoning_tokens: 2 },
            total_tokens: 7,
          },
        },
      },
    ],
    usage: usage["openai-responses-compatible"],
  }),
} as const satisfies Record<ProviderKind, ProtocolFixture>;

export function providerConformanceFixture(
  kind: ProviderKind,
): ProviderAdapterConformanceFixture {
  return { ...fixtures[kind], dialect: getProviderDialect(kind) };
}

export function providerConformanceFixtureKinds(): ProviderKind[] {
  return (Object.keys(fixtures) as ProviderKind[]).sort();
}

function fixture(
  kind: ProviderKind,
  scenarios: Omit<ProtocolFixture, "kind" | "model" | "provider">,
): ProtocolFixture {
  const provider: ProviderInstance = {
    id: `provider_conformance_${kind}`,
    orgId: "org_conformance",
    type: kind,
    name: `${kind} conformance provider`,
    baseUrl:
      kind === "ollama" ? "http://ollama.invalid" : "https://api.invalid/v1",
    credentialRef: "env://ROMEO_CONFORMANCE_CREDENTIAL",
    enabled: true,
    capabilities: defaultProviderCapabilities(kind),
  };
  const model: BaseModel = {
    id: `model_conformance_${kind}`,
    providerId: provider.id,
    name: kind === "ollama" ? "llama-conformance" : "model-conformance",
    displayName: `${kind} conformance model`,
    enabled: true,
    capabilities: defaultProviderCapabilities(kind),
    contextWindow: 8192,
  };
  return { kind, model, provider, ...scenarios };
}

function openAiSse(events: readonly unknown[]): Response {
  return streamResponse(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
  );
}

function anthropicSse(
  events: readonly (Record<string, unknown> & { type: string })[],
): Response {
  return streamResponse(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
  );
}

function malformedSse(protocol: "anthropic" | "openai"): Response {
  if (protocol === "anthropic") {
    const event = {
      type: "content_block_delta",
      index: "invalid",
      delta: { type: "text_delta", text: 42 },
      private: PROVIDER_CONFORMANCE_SENTINELS.malformedChunk,
    };
    return streamResponse(
      `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
  return openAiSse([
    {
      type: "romeo.invalid_event",
      choices: "invalid",
      private: PROVIDER_CONFORMANCE_SENTINELS.malformedChunk,
    },
  ]);
}

function jsonLines(events: readonly unknown[]): Response {
  return new Response(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { headers: { "content-type": "application/x-ndjson" }, status: 200 },
  );
}

function streamResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}
