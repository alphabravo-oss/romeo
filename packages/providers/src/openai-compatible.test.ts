import { describe, expect, it } from "vitest";

import { openAiCompatibleCapabilities } from "./capabilities";
import { openAiCompatibleAdapter } from "./adapters/openai-compatible";
import type { BaseModel, ProviderInstance, StreamChatChunk } from "./types";

describe("OpenAI-compatible adapter", () => {
  it("streams text and usage from chat completion SSE", async () => {
    const calls: Array<{ body?: string; headers: HeadersInit; url: string }> =
      [];
    const chunks = await collect(
      openAiCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async (input, init) => {
          const call: { body?: string; headers: HeadersInit; url: string } = {
            url: String(input),
            headers: init?.headers ?? {},
          };
          if (typeof init?.body === "string") call.body = init.body;
          calls.push(call);
          return new Response(
            sse([
              { choices: [{ delta: { content: "Hello " } }] },
              { choices: [{ delta: { content: "Romeo" } }] },
              {
                usage: {
                  prompt_tokens: 3,
                  completion_tokens: 4,
                  total_tokens: 7,
                },
              },
            ]),
            { status: 200 },
          );
        },
        messages: [{ role: "user", content: "hello" }],
        model,
        provider,
        tools: [
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
        ],
      }),
    );

    expect(chunks).toEqual([
      "Hello ",
      "Romeo",
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          source: "openai-compatible",
        },
      },
    ]);
    expect(calls[0]?.url).toBe("https://api.example/v1/chat/completions");
    expect(calls[0]?.body).toContain('"stream":true');
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "tool_calculator",
            description: "Evaluate arithmetic.",
            parameters: {
              type: "object",
              properties: { expression: { type: "string" } },
              required: ["expression"],
              additionalProperties: false,
            },
          },
        },
      ],
    });
    expect(JSON.stringify(calls[0]?.headers)).toContain(
      "Bearer provider-api-key",
    );
  });

  it("normalizes fragmented streamed tool calls", async () => {
    const chunks = await collect(
      openAiCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async () =>
          new Response(
            sse([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_raw_provider_id",
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
            ]),
            { status: 200 },
          ),
        messages: [{ role: "user", content: "calculate" }],
        model,
        provider,
      }),
    );

    expect(chunks).toEqual([
      {
        type: "tool_call",
        toolCall: {
          providerCallId: "call_raw_provider_id",
          name: "tool_calculator",
          arguments: { expression: "2 + 2" },
          argumentKeys: ["expression"],
        },
      },
    ]);
  });

  it("preserves batched streamed tool calls for one assistant turn", async () => {
    const chunks = await collect(
      openAiCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async () =>
          new Response(
            sse([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_calculator",
                          function: {
                            name: "tool_calculator",
                            arguments: JSON.stringify({ expression: "2 + 2" }),
                          },
                        },
                        {
                          index: 1,
                          id: "call_datetime",
                          function: {
                            name: "tool_datetime",
                            arguments: JSON.stringify({ timeZone: "UTC" }),
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ]),
            { status: 200 },
          ),
        messages: [{ role: "user", content: "calculate and date" }],
        model,
        provider,
      }),
    );

    expect(chunks).toEqual([
      {
        type: "tool_call",
        toolCall: {
          providerCallId: "call_calculator",
          name: "tool_calculator",
          arguments: { expression: "2 + 2" },
          argumentKeys: ["expression"],
        },
        toolCalls: [
          {
            providerCallId: "call_calculator",
            name: "tool_calculator",
            arguments: { expression: "2 + 2" },
            argumentKeys: ["expression"],
          },
          {
            providerCallId: "call_datetime",
            name: "tool_datetime",
            arguments: { timeZone: "UTC" },
            argumentKeys: ["timeZone"],
          },
        ],
      },
    ]);
  });

  it("serializes tool continuation messages for chat completions", async () => {
    let requestBody: Record<string, unknown> | undefined;

    await collect(
      openAiCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body));
          return new Response(
            sse([{ choices: [{ delta: { content: "ok" } }] }]),
            { status: 200 },
          );
        },
        messages: [
          { role: "user", content: "calculate" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                providerCallId: "call_provider_1",
                name: "tool_calculator",
                arguments: { expression: "2 + 2" },
                argumentKeys: ["expression"],
              },
            ],
          },
          {
            role: "tool",
            content: JSON.stringify({ result: 4 }),
            name: "tool_calculator",
            toolCallId: "call_provider_1",
          },
        ],
        model,
        provider,
      }),
    );

    expect(requestBody?.messages).toEqual([
      { role: "user", content: "calculate" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_provider_1",
            type: "function",
            function: {
              name: "tool_calculator",
              arguments: JSON.stringify({ expression: "2 + 2" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: JSON.stringify({ result: 4 }),
        name: "tool_calculator",
        tool_call_id: "call_provider_1",
      },
    ]);
  });

  it("fails closed when a configured provider credential is unavailable", async () => {
    await expect(
      collect(
        openAiCompatibleAdapter.streamChat({
          messages: [{ role: "user", content: "hello" }],
          model,
          provider: { ...provider, credentialRef: "env://OPENAI_API_KEY" },
        }),
      ),
    ).rejects.toEqual({ errorCode: "provider_credential_unavailable" });
  });
});

const provider: ProviderInstance = {
  id: "provider_openai",
  orgId: "org_default",
  type: "openai-compatible",
  name: "OpenAI-compatible",
  baseUrl: "https://api.example/v1",
  enabled: true,
  capabilities: openAiCompatibleCapabilities,
};

const model: BaseModel = {
  id: "model_openai",
  providerId: provider.id,
  name: "gpt-compatible",
  displayName: "GPT compatible",
  enabled: true,
  capabilities: openAiCompatibleCapabilities,
  contextWindow: 128000,
};

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

async function collect(
  input: AsyncIterable<StreamChatChunk>,
): Promise<StreamChatChunk[]> {
  const chunks: StreamChatChunk[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return chunks;
}
