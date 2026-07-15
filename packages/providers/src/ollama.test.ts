import { afterEach, describe, expect, it, vi } from "vitest";

import { ollamaAdapter } from "./adapters/ollama";
import { defaultProviderCapabilities } from "./capabilities";
import type { BaseModel, ProviderInstance, StreamChatChunk } from "./types";

const provider: ProviderInstance = {
  id: "provider_ollama",
  orgId: "org_default",
  type: "ollama",
  name: "Local Ollama",
  baseUrl: "http://localhost:11434",
  enabled: true,
  capabilities: defaultProviderCapabilities("ollama"),
};

const model: BaseModel = {
  id: "model_ollama_default",
  providerId: provider.id,
  name: "llama3.2",
  displayName: "Ollama llama3.2",
  enabled: true,
  capabilities: defaultProviderCapabilities("ollama"),
  contextWindow: 8192,
};

describe("ollama adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers local Ollama model tags when the runtime is reachable", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        models: [
          { name: "llama3.2:latest" },
          { name: "nomic-embed-text:latest" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const models = await ollamaAdapter.listModels(provider);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://localhost:11434/api/tags"),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(models.map((model) => model.name)).toEqual([
      "llama3.2:latest",
      "nomic-embed-text:latest",
    ]);
    expect(models[0]).toMatchObject({
      id: "model_provider_ollama_llama3_2_latest",
      displayName: "Ollama llama3.2:latest",
    });
  });

  it("falls back to the default model when local Ollama discovery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const models = await ollamaAdapter.listModels(provider);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "model_provider_ollama_default",
      name: "llama3.2",
    });
  });

  it("streams text, usage, and tool definitions through the Ollama chat API", async () => {
    const calls: Array<{ body?: string; headers: HeadersInit; url: string }> =
      [];
    const chunks = await collect(
      ollamaAdapter.streamChat({
        apiKey: "ollama-proxy-token",
        fetchImpl: async (input, init) => {
          const call: { body?: string; headers: HeadersInit; url: string } = {
            url: String(input),
            headers: init?.headers ?? {},
          };
          if (typeof init?.body === "string") call.body = init.body;
          calls.push(call);
          return new Response(
            jsonLines([
              {
                message: { role: "assistant", content: "Hello " },
                done: false,
              },
              { message: { role: "assistant", content: "Romeo" }, done: false },
              { done: true, prompt_eval_count: 3, eval_count: 4 },
            ]),
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
          source: "ollama",
        },
      },
    ]);
    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
    expect(JSON.stringify(calls[0]?.headers)).toContain(
      "Bearer ollama-proxy-token",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      model: "llama3.2",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
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
  });

  it("normalizes streamed Ollama tool calls", async () => {
    const chunks = await collect(
      ollamaAdapter.streamChat({
        fetchImpl: async () =>
          new Response(
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
                done: false,
              },
            ]),
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
          providerCallId: expect.stringMatching(/^provider_call_/u),
          name: "tool_calculator",
          arguments: { expression: "2 + 2" },
          argumentKeys: ["expression"],
        },
      },
    ]);
  });

  it("serializes tool continuation messages for Ollama chat", async () => {
    let requestBody: Record<string, unknown> | undefined;

    await collect(
      ollamaAdapter.streamChat({
        fetchImpl: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body));
          return new Response(
            jsonLines([
              { message: { role: "assistant", content: "ok" }, done: true },
            ]),
          );
        },
        messages: [
          { role: "user", content: "calculate" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                providerCallId: "call_ollama_1",
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
            toolCallId: "call_ollama_1",
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
            function: {
              name: "tool_calculator",
              arguments: { expression: "2 + 2" },
            },
          },
        ],
      },
      {
        role: "tool",
        content: JSON.stringify({ result: 4 }),
        tool_name: "tool_calculator",
        tool_call_id: "call_ollama_1",
      },
    ]);
  });

  it("fails closed when a configured Ollama credential cannot be resolved", async () => {
    await expect(
      collect(
        ollamaAdapter.streamChat({
          messages: [{ role: "user", content: "hello" }],
          model,
          provider: { ...provider, credentialRef: "env://OLLAMA_API_KEY" },
        }),
      ),
    ).rejects.toEqual({ errorCode: "provider_credential_unavailable" });
  });
});

function jsonLines(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
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
