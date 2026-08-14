import { describe, expect, it } from "vitest";

import { ProviderDialectSummarySchema } from "./providers";

const summary = {
  contractVersion: "1",
  operations: {
    audio: false,
    batches: false,
    capabilityProbing: false,
    chat: true,
    discovery: true,
    embeddings: true,
    errorNormalization: false,
    files: false,
    imageGeneration: true,
    tokenCounting: false,
    usageParsing: true,
  },
  version: "openai-chat-completions.v1",
} as const;

describe("provider dialect summary contract", () => {
  it("accepts the complete detached operation truth table", () => {
    expect(ProviderDialectSummarySchema.parse(summary)).toEqual(summary);
  });

  it("rejects incomplete or optimistic operation metadata", () => {
    const { audio: _audio, ...incompleteOperations } = summary.operations;
    expect(
      ProviderDialectSummarySchema.safeParse({
        ...summary,
        operations: incompleteOperations,
      }).success,
    ).toBe(false);
    expect(
      ProviderDialectSummarySchema.safeParse({
        ...summary,
        operations: { ...summary.operations, realtime: true },
      }).success,
    ).toBe(false);
  });
});
