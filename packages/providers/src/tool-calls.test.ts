import { describe, expect, it } from "vitest";

import {
  normalizeProviderToolCall,
  normalizeProviderToolCalls,
} from "./tool-calls";

describe("provider tool-call normalization", () => {
  it("normalizes OpenAI-compatible chat completion tool calls", () => {
    const call = normalizeProviderToolCall({
      id: "call_raw_provider_id_1",
      type: "function",
      function: {
        name: "tool_calculator",
        arguments:
          '{"expression":"raw expression value","precision":2,"secret":"do-not-log"}',
      },
    });

    expect(call).toEqual({
      providerCallId: "call_raw_provider_id_1",
      name: "tool_calculator",
      arguments: {
        expression: "raw expression value",
        precision: 2,
        secret: "do-not-log",
      },
      argumentKeys: ["expression", "precision", "secret"],
    });
  });

  it("normalizes OpenAI Responses function-call items", () => {
    const calls = normalizeProviderToolCalls([
      {
        type: "function_call",
        call_id: "call_response_1",
        name: "connector/github.search",
        arguments: { query: "romeo", limit: 5 },
      },
      { type: "message", content: "ignored" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      providerCallId: "call_response_1",
      name: "connector/github.search",
      argumentKeys: ["limit", "query"],
    });
  });

  it("rejects invalid names and non-object arguments", () => {
    expect(
      normalizeProviderToolCall({
        id: "call_bad_name",
        name: "bad name with spaces",
        arguments: {},
      }),
    ).toBeUndefined();
    expect(
      normalizeProviderToolCall({
        id: "call_bad_args",
        name: "tool_calculator",
        arguments: '["not","an","object"]',
      }),
    ).toBeUndefined();
  });
});
