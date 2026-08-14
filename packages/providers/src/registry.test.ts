import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEmbeddingAdapter,
  getImageGenerationAdapter,
  getProviderAdapter,
  getProviderDialect,
  getProviderDialectSummary,
  getProviderDiscoveryAdapter,
  getProviderUsageParser,
  listProviderDialects,
} from "./registry";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider dialect registry", () => {
  it("registers every provider kind with a stable version and truthful operations", () => {
    expect(listProviderDialects()).toEqual([
      {
        contractVersion: "1",
        kind: "anthropic",
        operations: {
          audio: false,
          batches: false,
          capabilityProbing: false,
          chat: true,
          discovery: true,
          embeddings: false,
          errorNormalization: true,
          files: false,
          imageGeneration: false,
          tokenCounting: false,
          usageParsing: true,
        },
        version: "anthropic-messages.v1",
      },
      {
        contractVersion: "1",
        kind: "ollama",
        operations: {
          audio: false,
          batches: false,
          capabilityProbing: false,
          chat: true,
          discovery: true,
          embeddings: true,
          errorNormalization: true,
          files: false,
          imageGeneration: false,
          tokenCounting: false,
          usageParsing: true,
        },
        version: "ollama-native.v1",
      },
      {
        contractVersion: "1",
        kind: "openai-compatible",
        operations: {
          audio: false,
          batches: false,
          capabilityProbing: false,
          chat: true,
          discovery: true,
          embeddings: true,
          errorNormalization: true,
          files: false,
          imageGeneration: true,
          tokenCounting: false,
          usageParsing: true,
        },
        version: "openai-chat-completions.v1",
      },
      {
        contractVersion: "1",
        kind: "openai-responses-compatible",
        operations: {
          audio: false,
          batches: false,
          capabilityProbing: false,
          chat: true,
          discovery: true,
          embeddings: true,
          errorNormalization: true,
          files: false,
          imageGeneration: true,
          tokenCounting: false,
          usageParsing: true,
        },
        version: "openai-responses.v1",
      },
    ]);
  });

  it("resolves operation adapters without a provider-kind switch", () => {
    expect(getProviderAdapter("anthropic").kind).toBe("anthropic");
    expect(getProviderDiscoveryAdapter("anthropic").kind).toBe("anthropic");
    expect(getEmbeddingAdapter("ollama").kind).toBe("ollama");
    expect(getImageGenerationAdapter("openai-compatible").kind).toBe(
      "openai-compatible",
    );
    expect(getProviderDialect("openai-responses-compatible")).toMatchObject({
      kind: "openai-responses-compatible",
      version: "openai-responses.v1",
    });
    expect(getProviderDialectSummary("anthropic").operations).toEqual({
      audio: false,
      batches: false,
      capabilityProbing: false,
      chat: true,
      discovery: true,
      embeddings: false,
      errorNormalization: true,
      files: false,
      imageGeneration: false,
      tokenCounting: false,
      usageParsing: true,
    });
    expect(
      getProviderUsageParser("ollama").parseUsage({
        prompt_eval_count: 2,
        eval_count: 3,
      }),
    ).toMatchObject({ inputTokens: 2, outputTokens: 3 });
  });

  it("fails explicitly when a dialect does not implement an operation", () => {
    expect(() => getEmbeddingAdapter("anthropic")).toThrow(
      "anthropic does not expose an embeddings API.",
    );
    expect(() => getImageGenerationAdapter("ollama")).toThrow(
      "ollama does not expose an image generation API.",
    );
    expect(
      getProviderUsageParser("anthropic").parseUsage({
        type: "message_start",
        message: { usage: { input_tokens: 4, output_tokens: 0 } },
      }),
    ).toMatchObject({ inputTokens: 4, outputTokens: 0 });
  });

  it("returns detached summaries that cannot mutate the registry", () => {
    const summary = listProviderDialects();
    (summary[0]!.operations as { embeddings: boolean }).embeddings = true;
    expect(listProviderDialects()[0]!.operations.embeddings).toBe(false);
  });

  it("does not start network or recurring work when imported", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const listenerCounts = new Map(
      ["beforeExit", "exit", "SIGINT", "SIGTERM", "unhandledRejection"].map(
        (event) => [event, process.listenerCount(event)] as const,
      ),
    );
    vi.resetModules();

    await import("./registry");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    for (const [event, count] of listenerCounts) {
      expect(process.listenerCount(event)).toBe(count);
    }
  });
});
