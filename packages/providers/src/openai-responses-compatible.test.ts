import { describe, expect, it } from "vitest";

import { openAiResponsesCompatibleCapabilities } from "./capabilities";
import { openAiResponsesCompatibleAdapter } from "./adapters/openai-responses-compatible";
import type { BaseModel, ProviderInstance, StreamChatChunk } from "./types";

describe("OpenAI Responses-compatible adapter", () => {
  it("streams text and usage from Responses SSE", async () => {
    const calls: Array<{ body?: string; headers: HeadersInit; url: string }> =
      [];
    const chunks = await collect(
      openAiResponsesCompatibleAdapter.streamChat({
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
              { type: "response.output_text.delta", delta: "Hello " },
              { type: "response.output_text.delta", delta: "Romeo" },
              {
                type: "response.completed",
                response: {
                  usage: {
                    input_tokens: 3,
                    output_tokens: 4,
                    total_tokens: 7,
                  },
                },
              },
            ]),
            { status: 200 },
          );
        },
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "hello" },
        ],
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
          source: "openai-responses-compatible",
        },
      },
    ]);
    expect(calls[0]?.url).toBe("https://api.example/v1/responses");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      input: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "hello" },
      ],
      model: "gpt-compatible",
      store: false,
      stream: true,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
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
    });
    expect(JSON.stringify(calls[0]?.headers)).toContain(
      "Bearer provider-api-key",
    );
  });

  it("normalizes Responses function-call output items", async () => {
    const chunks = await collect(
      openAiResponsesCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async () =>
          new Response(
            sse([
              {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  call_id: "call_response_1",
                  name: "tool_calculator",
                  arguments: JSON.stringify({ expression: "2 + 2" }),
                },
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
          providerCallId: "call_response_1",
          name: "tool_calculator",
          arguments: { expression: "2 + 2" },
          argumentKeys: ["expression"],
        },
      },
    ]);
  });

  it("normalizes fragmented Responses function-call arguments", async () => {
    const chunks = await collect(
      openAiResponsesCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async () =>
          new Response(
            sse([
              {
                type: "response.output_item.added",
                item: {
                  id: "item_1",
                  type: "function_call",
                  call_id: "call_response_1",
                  name: "tool_calculator",
                },
              },
              {
                type: "response.function_call_arguments.delta",
                item_id: "item_1",
                delta: '{"expression"',
              },
              {
                type: "response.function_call_arguments.done",
                item_id: "item_1",
                arguments: '{"expression":"2 + 2"}',
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
          providerCallId: "call_response_1",
          name: "tool_calculator",
          arguments: { expression: "2 + 2" },
          argumentKeys: ["expression"],
        },
      },
    ]);
  });

  it("serializes tool continuation items for Responses", async () => {
    let requestBody: Record<string, unknown> | undefined;

    await collect(
      openAiResponsesCompatibleAdapter.streamChat({
        apiKey: "provider-api-key",
        fetchImpl: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body));
          return new Response(
            sse([{ type: "response.output_text.delta", delta: "ok" }]),
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
                providerCallId: "call_response_1",
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
            toolCallId: "call_response_1",
          },
        ],
        model,
        provider,
      }),
    );

    expect(requestBody?.input).toEqual([
      { role: "user", content: "calculate" },
      {
        type: "function_call",
        call_id: "call_response_1",
        name: "tool_calculator",
        arguments: JSON.stringify({ expression: "2 + 2" }),
      },
      {
        type: "function_call_output",
        call_id: "call_response_1",
        output: JSON.stringify({ result: 4 }),
      },
    ]);
  });

  it("fails closed when a configured provider credential is unavailable", async () => {
    await expect(
      collect(
        openAiResponsesCompatibleAdapter.streamChat({
          messages: [{ role: "user", content: "hello" }],
          model,
          provider: { ...provider, credentialRef: "env://OPENAI_API_KEY" },
        }),
      ),
    ).rejects.toEqual({ errorCode: "provider_credential_unavailable" });
  });
});

const provider: ProviderInstance = {
  id: "provider_openai_responses",
  orgId: "org_default",
  type: "openai-responses-compatible",
  name: "OpenAI Responses-compatible",
  baseUrl: "https://api.example/v1",
  enabled: true,
  capabilities: openAiResponsesCompatibleCapabilities,
};

const model: BaseModel = {
  id: "model_openai_responses",
  providerId: provider.id,
  name: "gpt-compatible",
  displayName: "GPT compatible",
  enabled: true,
  capabilities: openAiResponsesCompatibleCapabilities,
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
