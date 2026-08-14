import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteOllamaModel,
  ollamaAdapter,
  pullOllamaModel,
} from "./adapters/ollama";
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
    vi.useRealTimers();
  });

  it("verifies the configured Ollama endpoint without syncing models", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ models: [] }),
    );

    await expect(
      ollamaAdapter.health(provider, { fetchImpl }),
    ).resolves.toEqual({ ok: true, message: "Connected to Ollama." });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:11434/api/tags");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an unavailable Ollama endpoint", async () => {
    await expect(
      ollamaAdapter.health(provider, {
        fetchImpl: async () => new Response(null, { status: 503 }),
      }),
    ).resolves.toEqual({
      ok: false,
      message: "The provider is temporarily unavailable.",
    });
  });

  it("pulls an Ollama model and returns the final download progress", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          [
            JSON.stringify({ status: "pulling manifest" }),
            JSON.stringify({
              status: "downloading",
              total: 100,
              completed: 40,
            }),
            JSON.stringify({
              status: "success",
              total: 100,
              completed: 100,
              digest: "sha256:test",
            }),
          ].join("\n"),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    );

    await expect(
      pullOllamaModel(provider, "gemma3:4b", { fetchImpl }),
    ).resolves.toEqual({
      completed: 100,
      digest: "sha256:test",
      model: "gemma3:4b",
      status: "success",
      total: 100,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:11434/api/pull");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "gemma3:4b", stream: true }),
    });
  });

  it("deletes an Ollama model through the official SDK", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ status: "success" }),
    );

    await expect(
      deleteOllamaModel(provider, "gemma3:4b", { fetchImpl }),
    ).resolves.toEqual({ model: "gemma3:4b", status: "success" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:11434/api/delete");
    expect(init).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ name: "gemma3:4b" }),
    });
  });

  it("discovers local Ollama model tags when the runtime is reachable", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          models: [
            { name: "llama3.2:latest" },
            { name: "nomic-embed-text:latest" },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const models = await ollamaAdapter.listModels(provider);

    const tagsCall = fetchImpl.mock.calls.find(([input]) =>
      String(input).endsWith("/api/tags"),
    );
    expect(tagsCall).toBeDefined();
    expect(String(tagsCall?.[0])).toBe("http://localhost:11434/api/tags");
    expect(new Headers(tagsCall?.[1]?.headers).get("accept")).toBe(
      "application/json",
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

  it("reports local Ollama discovery failures instead of inventing a fallback model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await expect(ollamaAdapter.listModels(provider)).rejects.toMatchObject({
      category: "unexpected",
      errorCode: "provider_unexpected_failure",
      operation: "discovery",
    });
  });

  it("enforces configured Ollama model IDs after endpoint discovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/tags")
          ? Response.json({
              models: [{ name: "gemma3:4b" }, { name: "llama3.2:latest" }],
            })
          : Response.json({ capabilities: ["completion"] }),
      ),
    );

    const models = await ollamaAdapter.listModels({
      ...provider,
      modelIds: ["gemma3:4b"],
    });

    expect(models.map((item) => item.name)).toEqual(["gemma3:4b"]);
  });

  it("detects per-model tools, vision, context, and marks embedding-only models unavailable for chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/tags"))
          return Response.json({
            models: [
              { name: "gemma3:4b" },
              { name: "llama3.2" },
              { name: "llava" },
              { name: "nomic-embed-text" },
            ],
          });
        const name = JSON.parse(String(init?.body)).model as string;
        const payloads: Record<string, unknown> = {
          "gemma3:4b": {
            capabilities: ["completion"],
            model_info: { "gemma.context_length": 32768 },
          },
          "llama3.2": { capabilities: ["completion", "tools"] },
          llava: { capabilities: ["completion", "vision"] },
          "nomic-embed-text": { capabilities: ["embedding"] },
        };
        return Response.json(payloads[name]);
      }),
    );

    const models = await ollamaAdapter.listModels(provider);

    expect(models.map((item) => item.name)).toEqual([
      "gemma3:4b",
      "llama3.2",
      "llava",
      "nomic-embed-text",
    ]);
    expect(models[0]).toMatchObject({
      contextWindow: 32768,
      capabilities: { toolCalling: false },
    });
    expect(models[1]).toMatchObject({ capabilities: { toolCalling: true } });
    expect(models[2]).toMatchObject({
      capabilities: { vision: true, modalities: ["text", "vision"] },
    });
    expect(models[3]).toMatchObject({
      enabled: false,
      capabilities: { modalities: ["embeddings"] },
    });
  });

  it("falls back per model when /api/show is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/tags")
          ? Response.json({ models: [{ name: "legacy" }] })
          : new Response(null, { status: 404 }),
      ),
    );
    const [legacy] = await ollamaAdapter.listModels(provider);
    expect(legacy).toMatchObject({
      capabilities: defaultProviderCapabilities("ollama"),
      contextWindow: 8192,
    });
  });

  it("times out a slow /api/show request and keeps discovery usable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/tags"))
          return Response.json({ models: [{ name: "slow-model" }] });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );
    const pending = ollamaAdapter.listModels(provider);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        name: "slow-model",
        capabilities: defaultProviderCapabilities("ollama"),
        contextWindow: 8192,
      }),
    ]);
  });

  it("streams text, usage, and tool definitions through the Ollama chat API", async () => {
    const rawReasoningSentinel = "raw-ollama-thinking-secret";
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
              {
                message: {
                  role: "assistant",
                  content: "",
                  thinking: rawReasoningSentinel,
                },
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
          source: "ollama",
        },
      },
    ]);
    expect(JSON.stringify(chunks)).not.toContain(rawReasoningSentinel);
    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
    expect(new Headers(calls[0]?.headers).get("authorization")).toBe(
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
                done: true,
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
