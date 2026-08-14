import type { ProviderCapabilities, ProviderKind } from "./types";

export const openAiCompatibleCapabilities: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: true,
  reasoning: false,
  temperature: true,
  imageGeneration: false,
  modalities: ["text"],
  deployment: {
    mode: "hosted-api",
    networkAccess: "external-http",
    credentialRequired: true,
  },
};

export const openAiResponsesCompatibleCapabilities: ProviderCapabilities = {
  ...openAiCompatibleCapabilities,
  reasoning: true,
};

export const anthropicCapabilities: ProviderCapabilities = {
  ...openAiCompatibleCapabilities,
  vision: true,
  structuredJson: false,
  modalities: ["text", "vision"],
};

export const ollamaCapabilities: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: false,
  reasoning: false,
  temperature: true,
  imageGeneration: false,
  modalities: ["text"],
  deployment: {
    mode: "local-runtime",
    networkAccess: "local-http",
    credentialRequired: false,
  },
};

const defaultCapabilitiesByProvider = {
  anthropic: anthropicCapabilities,
  "openai-compatible": openAiCompatibleCapabilities,
  "openai-responses-compatible": openAiResponsesCompatibleCapabilities,
  ollama: ollamaCapabilities,
} satisfies Record<ProviderKind, ProviderCapabilities>;

export function defaultProviderCapabilities(
  kind: ProviderKind,
): ProviderCapabilities {
  return defaultCapabilitiesByProvider[kind];
}

export { looksLikeImageGenerationModel as detectsImageGenerationModel } from "./model-discovery";
