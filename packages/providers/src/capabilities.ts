import type { ProviderCapabilities, ProviderKind } from "./types";

export const openAiCompatibleCapabilities: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: true,
  reasoning: false,
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

export const ollamaCapabilities: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: false,
  reasoning: false,
  modalities: ["text"],
  deployment: {
    mode: "local-runtime",
    networkAccess: "local-http",
    credentialRequired: false,
  },
};

export function defaultProviderCapabilities(
  kind: ProviderKind,
): ProviderCapabilities {
  if (kind === "openai-compatible") return openAiCompatibleCapabilities;
  if (kind === "openai-responses-compatible")
    return openAiResponsesCompatibleCapabilities;
  return ollamaCapabilities;
}
