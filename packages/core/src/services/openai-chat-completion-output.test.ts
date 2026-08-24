import { describe, expect, it } from "vitest";

import {
  collectChatProviderChunk,
  openAiChatCompletionStream,
  type ProviderOutput,
} from "./openai-chat-completion-output";

describe("OpenAI compatibility output bounds", () => {
  it("rejects oversized tool arguments and private reasoning", () => {
    const output: ProviderOutput = { content: "", toolCalls: [] };
    expect(() =>
      collectChatProviderChunk(output, {
        type: "tool_call",
        toolCall: {
          providerCallId: "call_large",
          name: "tool.large",
          arguments: { value: "x".repeat(1_000_001) },
          argumentKeys: ["value"],
        },
      }),
    ).toThrowError("Provider tool-call arguments exceeded the size limit.");
    expect(() =>
      collectChatProviderChunk(output, {
        type: "reasoning",
        text: "x".repeat(2_000_001),
      }),
    ).toThrowError(
      "Provider reasoning output exceeded the compatibility limit.",
    );
  });

  it("bounds aggregate tool argument keys", () => {
    const output: ProviderOutput = { content: "", toolCalls: [] };
    const argumentsRecord = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`key_${index}`, index]),
    );
    expect(() =>
      collectChatProviderChunk(output, {
        type: "tool_call",
        toolCall: {
          providerCallId: "call_many_keys",
          name: "tool.many_keys",
          arguments: argumentsRecord,
          argumentKeys: Object.keys(argumentsRecord),
        },
      }),
    ).toThrowError("Provider tool-call arguments exceeded the key limit.");
  });

  it("emits compatibility SSE frames through a cancellable pull stream", async () => {
    const stream = openAiChatCompletionStream(
      {
        model: "model_test",
        messages: [{ role: "user", content: "bounded" }],
        stream: true,
      },
      { content: "x".repeat(40_000), toolCalls: [] },
    );
    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      '"role":"assistant"',
    );
    await reader.cancel();
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
