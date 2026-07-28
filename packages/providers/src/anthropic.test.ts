import { describe, expect, it, vi } from "vitest";

import { anthropicAdapter } from "./adapters/anthropic";
import { defaultProviderCapabilities } from "./capabilities";
import type { BaseModel, ProviderInstance } from "./types";

const provider: ProviderInstance = {
  id: "provider_anthropic",
  orgId: "org_1",
  type: "anthropic",
  name: "Anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  credentialRef: "env://ANTHROPIC_API_KEY",
  enabled: true,
  capabilities: defaultProviderCapabilities("anthropic"),
};

const model: BaseModel = {
  id: "model_claude",
  providerId: provider.id,
  name: "claude-sonnet-4-5",
  displayName: "Claude Sonnet",
  enabled: true,
  capabilities: defaultProviderCapabilities("anthropic"),
  contextWindow: 200_000,
};

describe("Anthropic adapter", () => {
  it("does not let an allowlist bypass the native Models API health check", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      anthropicAdapter.health(
        { ...provider, modelIds: ["claude-configured"] },
        { apiKey: "secret", fetchImpl },
      ),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("discovers native Anthropic models with required headers", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ data: [{ id: "claude-sonnet-4-5" }] }),
    );
    const models = await anthropicAdapter.listModels(provider, {
      apiKey: "secret",
      fetchImpl,
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      name: "claude-sonnet-4-5",
      contextWindow: 200_000,
      capabilities: { vision: true, toolCalling: true },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/models?limit=100");
    const headers = new Headers(init?.headers);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("x-api-key")).toBe("secret");
  });

  it("serializes system, vision, and tools and parses text, usage, and tool use", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 12 } } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "weather" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"city":"Paris"}' },
      },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", usage: { output_tokens: 5 } },
    ];
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          events
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    );
    const chunks = [];
    for await (const chunk of anthropicAdapter.streamChat({
      apiKey: "secret",
      fetchImpl,
      provider,
      model,
      messages: [
        { role: "system", content: "Be useful." },
        {
          role: "user",
          content: "Describe it",
          images: [{ mimeType: "image/png", dataBase64: "aGVsbG8=" }],
        },
      ],
      tools: [
        {
          name: "weather",
          description: "Get weather",
          parameters: { type: "object" },
        },
      ],
    }))
      chunks.push(chunk);

    expect(capturedBody).toMatchObject({
      system: "Be useful.",
      model: "claude-sonnet-4-5",
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "aGVsbG8=",
              },
            },
            { type: "text", text: "Describe it" },
          ],
        },
      ],
      tools: [{ name: "weather", input_schema: { type: "object" } }],
    });
    expect(chunks).toContain("Hello");
    expect(chunks).toContainEqual({
      type: "tool_call",
      toolCall: {
        providerCallId: "toolu_1",
        name: "weather",
        arguments: { city: "Paris" },
        argumentKeys: ["city"],
      },
    });
    expect(chunks).toContainEqual({
      type: "usage",
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        source: "anthropic",
      },
    });
  });
});
