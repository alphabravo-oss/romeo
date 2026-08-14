import { describe, expect, it } from "vitest";

import { defaultProviderCapabilities } from "@romeo/providers";

import {
  chatParametersFromParameters,
  requestedChatParametersForModel,
  samplingFromParameters,
} from "./run-sampling";

// A managed model version stores `parameters` as an open record, and before this existed nothing
// read it — temperature was saved, versioned, diffed and audited while every request went out with
// the provider's own default.
describe("samplingFromParameters", () => {
  it("carries the three knobs a provider request can hold", () => {
    expect(
      samplingFromParameters({ temperature: 0.2, topP: 0.9, maxTokens: 512 }),
    ).toEqual({ temperature: 0.2, topP: 0.9, maxTokens: 512 });
    expect(samplingFromParameters({ maxOutputTokens: 256 })).toEqual({
      maxTokens: 256,
    });
  });

  it("keeps zero, which is a meaningful temperature", () => {
    expect(samplingFromParameters({ temperature: 0 })).toEqual({
      temperature: 0,
    });
  });

  it("drops keys no provider request accepts", () => {
    expect(
      samplingFromParameters({ temperature: 0.5, presencePenalty: 1 }),
    ).toEqual({ temperature: 0.5 });
  });

  it("drops values that are not finite numbers", () => {
    expect(
      samplingFromParameters({
        temperature: "0.7" as unknown as number,
        topP: Number.NaN,
        maxTokens: Number.POSITIVE_INFINITY,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when there is nothing to pin", () => {
    expect(samplingFromParameters(undefined)).toBeUndefined();
    expect(samplingFromParameters({})).toBeUndefined();
  });

  it("keeps requested values for the centralized provider resolution boundary", () => {
    const model = {
      id: "model_reasoner",
      providerId: "provider_a",
      name: "o3",
      displayName: "o3",
      enabled: true,
      capabilities: {
        ...defaultProviderCapabilities("openai-compatible"),
        reasoning: true,
        temperature: false,
      },
      contextWindow: 200_000,
    };
    expect(
      requestedChatParametersForModel(model, {
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 512,
      }),
    ).toEqual({
      sampling: { temperature: 0.7, topP: 0.9, maxTokens: 512 },
    });
  });

  it("extracts only bounded reasoning and structured-output request shapes", () => {
    expect(
      chatParametersFromParameters({
        reasoning: { effort: "high", summary: "concise" },
        structuredOutput: {
          type: "json_schema",
          name: "answer",
          schema: { type: "object" },
          strict: true,
        },
      }),
    ).toEqual({
      reasoning: { effort: "high", summary: "concise" },
      structuredOutput: {
        type: "json_schema",
        name: "answer",
        schema: { type: "object" },
        strict: true,
      },
    });
    expect(
      chatParametersFromParameters({
        reasoningEffort: "unbounded",
        structuredOutput: { type: "template", prompt: "private" },
      }),
    ).toEqual({});
  });
});
