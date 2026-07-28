import type {
  EmbedTextsResult,
  EmbeddingProviderAdapter,
  ProviderTokenUsage,
} from "../types";
import { assertEmbeddingInput, parseEmbeddingMatrix } from "./embedding-utils";
import { createOpenAiClient } from "./provider-sdk";
import { normalizeProviderTokenUsage } from "../usage";

export const openAiCompatibleEmbeddingAdapter: EmbeddingProviderAdapter = {
  kind: "openai-compatible",
  async embedTexts(input): Promise<EmbedTextsResult> {
    assertEmbeddingInput(input.texts);
    const client = createOpenAiClient(
      input.provider,
      input.apiKey,
      input.fetchImpl,
    );
    const response = await client.embeddings.create(
      { model: input.model, input: input.texts, encoding_format: "float" },
      input.signal === undefined ? undefined : { signal: input.signal },
    );
    const matrix = parseEmbeddingMatrix(
      [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding),
      input.texts.length,
    );
    const usage = usageFromPayload(response.usage);
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
    return normalizeProviderTokenUsage(payload, {
      source: "openai-compatible",
    });
  } catch {
    return undefined;
  }
}
