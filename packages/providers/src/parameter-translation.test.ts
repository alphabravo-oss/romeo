import { describe, expect, it } from "vitest";

import { defaultProviderCapabilities } from "./capabilities";
import {
  hasRequestedProviderChatParameters,
  translateProviderChatParameters,
} from "./parameter-translation";
import { getProviderDialect, listProviderDialects } from "./registry";
import type {
  BaseModel,
  ProviderInstance,
  ProviderKind,
  ProviderToolDefinition,
  StreamChatChunk,
} from "./types";

const dialects = listProviderDialects();
const tool: ProviderToolDefinition = {
  name: "tool_calculator",
  description: "Evaluate arithmetic.",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
    additionalProperties: false,
  },
};
const structuredOutput = {
  type: "json_schema" as const,
  name: "calculation",
  schema: {
    type: "object",
    properties: { result: { type: "number" } },
    required: ["result"],
    additionalProperties: false,
  },
  strict: true,
};

describe("provider chat parameter translation", () => {
  it("has a policy and deterministic resolution for every registry dialect", () => {
    for (const { kind } of dialects) {
      const target = fixture(kind);
      expect(() =>
        translateProviderChatParameters({
          ...target,
          kind,
          sampling: { temperature: 0.7, topP: 0.8, maxTokens: 300 },
          reasoning: { effort: "high", summary: "concise" },
          structuredOutput,
          tools: [tool],
        }),
      ).not.toThrow();
    }
  });

  it("omits out-of-range, non-finite, oversized, and malformed values", () => {
    const target = fixture("openai-responses-compatible");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const translated = translateProviderChatParameters({
      ...target,
      sampling: {
        temperature: Number.NaN,
        topP: 2,
        maxTokens: target.model.contextWindow + 1,
      },
      reasoning: {
        effort: "extreme" as "high",
        summary: "raw" as "auto",
      },
      structuredOutput: {
        type: "json_schema",
        name: "invalid name",
        schema: cyclic,
      },
    });

    expect(translated.effective).toEqual({});
    expect(translated.summary.omissions).toEqual([
      { parameter: "sampling.temperature", reason: "invalid_value" },
      { parameter: "sampling.topP", reason: "invalid_value" },
      { parameter: "sampling.maxTokens", reason: "invalid_value" },
      { parameter: "reasoning.effort", reason: "invalid_value" },
      { parameter: "reasoning.summary", reason: "invalid_value" },
      { parameter: "structuredOutput", reason: "invalid_value" },
    ]);
  });

  it("uses selected model and provider capabilities rather than optimistic dialect support", () => {
    const target = fixture("openai-responses-compatible");
    target.model.capabilities = {
      ...target.model.capabilities,
      reasoning: false,
      structuredJson: false,
      temperature: false,
      toolCalling: false,
    };
    const translated = translateProviderChatParameters({
      ...target,
      sampling: { temperature: 0.5, topP: 0.5, maxTokens: 256 },
      reasoning: { effort: "medium" },
      structuredOutput,
      tools: [tool],
    });

    expect(translated.effective).toEqual({ sampling: { maxTokens: 256 } });
    expect(translated.summary.omissions).toEqual([
      {
        parameter: "sampling.temperature",
        reason: "unsupported_by_model_or_provider",
      },
      {
        parameter: "sampling.topP",
        reason: "unsupported_by_model_or_provider",
      },
      {
        parameter: "reasoning",
        reason: "unsupported_by_model_or_provider",
      },
      {
        parameter: "structuredOutput",
        reason: "unsupported_by_model_or_provider",
      },
      {
        parameter: "tools",
        reason: "unsupported_by_model_or_provider",
      },
    ]);
  });

  it("fails closed for a mixed valid and invalid tool set", () => {
    expect(() =>
      translateProviderChatParameters({
        ...fixture("openai-compatible"),
        tools: [tool, { ...tool, name: "invalid.tool.name" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "invalid_request_or_capability",
        errorCode: "provider_invalid_request_or_capability",
        retryable: false,
        status: 400,
      }),
    );
  });

  it("fails closed rather than truncating a tool set over the limit", () => {
    expect(() =>
      translateProviderChatParameters({
        ...fixture("openai-compatible"),
        tools: Array.from({ length: 65 }, (_, index) => ({
          ...tool,
          name: `tool_${index}`,
        })),
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "invalid_request_or_capability",
        errorCode: "provider_invalid_request_or_capability",
        retryable: false,
        status: 400,
      }),
    );
  });

  it("keeps a privacy-safe requested-versus-effective summary", () => {
    const target = fixture("anthropic");
    const translated = translateProviderChatParameters({
      ...target,
      sampling: { temperature: 1.5, topP: 0.8, maxTokens: 300 },
      reasoning: { effort: "high", summary: "detailed" },
      structuredOutput,
      tools: [tool],
    });

    expect(hasRequestedProviderChatParameters(translated.summary)).toBe(true);
    expect(translated.summary).toEqual({
      requested: {
        sampling: { temperature: 1.5, topP: 0.8, maxTokens: 300 },
        reasoning: { effort: "high", summary: "detailed" },
        structuredOutput: { type: "json_schema", strict: true },
        tools: { count: 1 },
      },
      effective: {
        sampling: { topP: 0.8, maxTokens: 300 },
        tools: { count: 1 },
      },
      omissions: [
        { parameter: "sampling.temperature", reason: "invalid_value" },
        {
          parameter: "reasoning",
          reason: "unsupported_by_model_or_provider",
        },
        {
          parameter: "structuredOutput",
          reason: "unsupported_by_dialect",
        },
      ],
    });
    expect(JSON.stringify(translated.summary)).not.toContain("calculation");
    expect(JSON.stringify(translated.summary)).not.toContain("tool_calculator");
    expect(JSON.stringify(translated.summary)).not.toContain("properties");
  });

  for (const { kind } of dialects) {
    it(`${kind} sends only its effective native fields`, async () => {
      const target = fixture(kind);
      if (kind === "openai-compatible") {
        target.provider.capabilities = {
          ...target.provider.capabilities,
          reasoning: true,
        };
        target.model.capabilities = {
          ...target.model.capabilities,
          reasoning: true,
        };
      }
      let body: Record<string, unknown> | undefined;
      await collect(
        getProviderDialect(kind).chat.streamChat({
          ...target,
          apiKey: "synthetic-key",
          fetchImpl: async (_request, init) => {
            body = JSON.parse(String(init?.body));
            return emptyStream(kind);
          },
          messages: [{ role: "user", content: "Synthetic request." }],
          sampling: { temperature: 0.7, topP: 0.8, maxTokens: 300 },
          reasoning: { effort: "high", summary: "concise" },
          structuredOutput,
          tools: [tool],
        }),
      );

      expect(body).toBeDefined();
      expectNativeBody(kind, body!);
    });

    it(`${kind} maps only its supported reasoning-policy controls`, async () => {
      const target = fixture(kind);
      target.provider.capabilities = {
        ...target.provider.capabilities,
        reasoning: true,
      };
      target.model.capabilities = {
        ...target.model.capabilities,
        reasoning: true,
      };
      let body: Record<string, unknown> | undefined;
      const request = collect(
        getProviderDialect(kind).chat.streamChat({
          ...target,
          apiKey: "synthetic-key",
          fetchImpl: async (_request, init) => {
            body = JSON.parse(String(init?.body));
            return emptyStream(kind);
          },
          messages: [{ role: "user", content: "Synthetic request." }],
          reasoningPolicy: {
            agentDefault: {
              schemaVersion: 1,
              mode: "auto",
              effort: "high",
            },
          },
        }),
      );

      if (kind === "anthropic" || kind === "ollama") {
        await expect(request).rejects.toMatchObject({
          errorCode: "provider_invalid_request_or_capability",
          retryable: false,
        });
        expect(body).toBeUndefined();
        return;
      }
      await request;

      expectReasoningPolicyBody(kind, body!);
      expect(JSON.stringify(body)).not.toContain("reasoningPolicy");
    });
  }
});

function expectReasoningPolicyBody(
  kind: ProviderKind,
  body: Record<string, unknown>,
): void {
  if (kind === "openai-responses-compatible") {
    expect(body).toMatchObject({ reasoning: { effort: "high" } });
    return;
  }
  if (kind === "openai-compatible") {
    expect(body).toMatchObject({ reasoning_effort: "high" });
    expect(body).not.toHaveProperty("reasoning");
    return;
  }
  expect(body).not.toHaveProperty("reasoning");
  expect(body).not.toHaveProperty("reasoning_effort");
}

function expectNativeBody(
  kind: ProviderKind,
  body: Record<string, unknown>,
): void {
  if (kind === "anthropic") {
    expect(body).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 300,
      tools: [{ name: "tool_calculator" }],
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("response_format");
    return;
  }
  if (kind === "ollama") {
    expect(body).toMatchObject({
      options: { temperature: 0.7, top_p: 0.8, num_predict: 300 },
      tools: [{ function: { name: "tool_calculator" } }],
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("format");
    return;
  }
  if (kind === "openai-compatible") {
    expect(body).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 300,
      reasoning_effort: "high",
      response_format: {
        type: "json_schema",
        json_schema: { name: "calculation", strict: true },
      },
      tools: [{ function: { name: "tool_calculator" } }],
    });
    expect(body).not.toHaveProperty("reasoning_summary");
    return;
  }
  expect(body).toMatchObject({
    temperature: 0.7,
    top_p: 0.8,
    max_output_tokens: 300,
    reasoning: { effort: "high", summary: "concise" },
    text: {
      format: { type: "json_schema", name: "calculation", strict: true },
    },
    tools: [{ name: "tool_calculator" }],
  });
}

function fixture(kind: ProviderKind): {
  model: BaseModel;
  provider: ProviderInstance;
} {
  const capabilities = { ...defaultProviderCapabilities(kind) };
  const provider: ProviderInstance = {
    id: `provider_parameters_${kind}`,
    orgId: "org_parameters",
    type: kind,
    name: `${kind} parameter provider`,
    baseUrl:
      kind === "ollama" ? "http://ollama.invalid" : "https://api.invalid/v1",
    enabled: true,
    capabilities,
  };
  return {
    provider,
    model: {
      id: `model_parameters_${kind}`,
      providerId: provider.id,
      name: "model-parameters",
      displayName: "Parameter model",
      enabled: true,
      capabilities: { ...capabilities },
      contextWindow: 8192,
    },
  };
}

function emptyStream(kind: ProviderKind): Response {
  if (kind === "ollama") return new Response('{"done":true}\n');
  return new Response(kind === "anthropic" ? "" : "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(input: AsyncIterable<StreamChatChunk>): Promise<void> {
  for await (const _chunk of input) {
    // Exhaust the protocol stream so adapter errors surface.
  }
}
