import { describe, expect, expectTypeOf, it } from "vitest";

import { anthropicAdapter } from "./adapters/anthropic";
import { ollamaEmbeddingAdapter } from "./adapters/ollama-embeddings";
import { openAiCompatibleImageAdapter } from "./adapters/openai-compatible-images";
import { getProviderDialect, listProviderDialects } from "./registry";
import { ollamaUsageParser } from "./usage";
import type {
  ProviderAudioAdapter,
  ProviderBatchesAdapter,
  ProviderCapabilityProbeAdapter,
  ProviderChatAdapter,
  ProviderDialectOperation,
  ProviderDiscoveryAdapter,
  ProviderEmbeddingsAdapter,
  ProviderErrorNormalizer,
  ProviderFilesAdapter,
  ProviderImageAdapter,
  ProviderTokenCountingAdapter,
  ProviderUsageParser,
} from "./types";

const operationNames = [
  "audio",
  "batches",
  "capabilityProbing",
  "chat",
  "discovery",
  "embeddings",
  "errorNormalization",
  "files",
  "imageGeneration",
  "tokenCounting",
  "usageParsing",
] as const satisfies readonly ProviderDialectOperation[];

type MissingOperation = Exclude<
  ProviderDialectOperation,
  (typeof operationNames)[number]
>;
const operationListIsExhaustive: MissingOperation extends never ? true : false =
  true;

describe("focused provider dialect interfaces", () => {
  it("keeps current adapters assignable only to their implemented operation contracts", () => {
    expectTypeOf(anthropicAdapter).toMatchTypeOf<ProviderDiscoveryAdapter>();
    expectTypeOf(anthropicAdapter).toMatchTypeOf<ProviderChatAdapter>();
    expectTypeOf(
      ollamaEmbeddingAdapter,
    ).toMatchTypeOf<ProviderEmbeddingsAdapter>();
    expectTypeOf(
      openAiCompatibleImageAdapter,
    ).toMatchTypeOf<ProviderImageAdapter>();
    expectTypeOf(ollamaUsageParser).toMatchTypeOf<ProviderUsageParser>();

    expect(Object.keys(anthropicAdapter).sort()).toEqual([
      "health",
      "kind",
      "listModels",
      "streamChat",
    ]);
    expect(Object.keys(ollamaEmbeddingAdapter).sort()).toEqual([
      "embedTexts",
      "kind",
    ]);
    expect(Object.keys(openAiCompatibleImageAdapter).sort()).toEqual([
      "generate",
      "kind",
    ]);
    expect(operationListIsExhaustive).toBe(true);
  });

  it("publishes operation metadata directly from adapter presence", () => {
    for (const summary of listProviderDialects()) {
      const dialect = getProviderDialect(summary.kind);
      for (const operation of operationNames) {
        expect(
          summary.operations[operation],
          `${summary.kind}.${operation}`,
        ).toBe(dialect[operation] !== undefined);
      }
    }
  });

  it("exports optional contracts without over-registering unsupported operations", () => {
    expectTypeOf<ProviderAudioAdapter>().toHaveProperty("transcribeAudio");
    expectTypeOf<ProviderBatchesAdapter>().toHaveProperty("createBatch");
    expectTypeOf<ProviderCapabilityProbeAdapter>().toHaveProperty(
      "probeCapabilities",
    );
    expectTypeOf<ProviderErrorNormalizer>().toHaveProperty("normalizeError");
    expectTypeOf<ProviderFilesAdapter>().toHaveProperty("uploadFile");
    expectTypeOf<ProviderTokenCountingAdapter>().toHaveProperty("countTokens");

    for (const summary of listProviderDialects()) {
      expect(summary.operations).toMatchObject({
        audio: false,
        batches: false,
        capabilityProbing: false,
        errorNormalization: true,
        files: false,
        tokenCounting: false,
      });
    }
  });
});
