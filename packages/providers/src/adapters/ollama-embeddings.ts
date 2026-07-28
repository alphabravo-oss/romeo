import type {
  EmbedTextsResult,
  EmbeddingProviderAdapter,
  ProviderTokenUsage,
} from "../types";
import { assertEmbeddingInput, parseEmbeddingMatrix } from "./embedding-utils";
import { createOllamaClient } from "./provider-sdk";
import { normalizeProviderTokenUsage } from "../usage";

export const ollamaEmbeddingAdapter: EmbeddingProviderAdapter = {
  kind: "ollama",
  async embedTexts(input): Promise<EmbedTextsResult> {
    assertEmbeddingInput(input.texts);
    const response = await createOllamaClient(input.provider, {
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }).embed({ model: input.model, input: input.texts });
    const matrix = parseEmbeddingMatrix(
      response.embeddings,
      input.texts.length,
    );
    const usage = usageFromPayload(response);
    return {
      model: response.model,
      dimensions: matrix.dimensions,
      embeddings: matrix.embeddings,
      ...(usage === undefined ? {} : { usage }),
    };
  },
};

function usageFromPayload(payload: unknown): ProviderTokenUsage | undefined {
  try {
    return normalizeProviderTokenUsage(payload, { source: "ollama" });
  } catch {
    return undefined;
  }
}
