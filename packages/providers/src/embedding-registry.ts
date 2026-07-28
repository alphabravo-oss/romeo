import { ollamaEmbeddingAdapter } from "./adapters/ollama-embeddings";
import { openAiCompatibleEmbeddingAdapter } from "./adapters/openai-compatible-embeddings";
import type { EmbeddingProviderAdapter, ProviderKind } from "./types";

export function getEmbeddingAdapter(
  kind: ProviderKind,
): EmbeddingProviderAdapter {
  if (kind === "openai-compatible" || kind === "openai-responses-compatible")
    return openAiCompatibleEmbeddingAdapter;
  if (kind === "ollama") return ollamaEmbeddingAdapter;
  throw new Error("Anthropic does not expose an embeddings API.");
}
