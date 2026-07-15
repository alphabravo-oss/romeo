import { ollamaAdapter } from "./adapters/ollama";
import { openAiCompatibleAdapter } from "./adapters/openai-compatible";
import { openAiResponsesCompatibleAdapter } from "./adapters/openai-responses-compatible";
import type { ModelProviderAdapter, ProviderKind } from "./types";

export function getProviderAdapter(kind: ProviderKind): ModelProviderAdapter {
  if (kind === "openai-compatible") {
    return openAiCompatibleAdapter;
  }
  if (kind === "openai-responses-compatible") {
    return openAiResponsesCompatibleAdapter;
  }

  return ollamaAdapter;
}
