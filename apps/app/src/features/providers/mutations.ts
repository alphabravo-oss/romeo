import {
  modelsCompatibilityPreview,
  modelsProbe,
  providersCreateConnection,
  providersDeleteOllamaModel,
  providersPullOllamaModel,
  providersSyncModels,
  providersUpdateConnection,
  providersUpdateModelCapabilities,
  providersUpdateModelEnabled,
  providersUpdateModelPricing,
  providersVerifyConnection,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  BaseModel,
  OllamaPullResult,
  OllamaDeleteResult,
  Provider,
  ProviderCapabilities,
  ProviderKind,
  ProviderVerification,
} from "./types";

export async function createProvider(input: {
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  modelIds?: string[];
}): Promise<Provider> {
  configureBrowserApiClients();
  const response = await providersCreateConnection({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateProvider(input: {
  providerId: string;
  name?: string;
  baseUrl?: string;
  credentialRef?: string;
  modelIds?: string[];
  enabled?: boolean;
}): Promise<Provider> {
  configureBrowserApiClients();
  const { providerId, ...body } = input;
  const response = await providersUpdateConnection({
    path: { providerId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function verifyProvider(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderVerification> {
  configureBrowserApiClients();
  const response = await providersVerifyConnection({
    path: { providerId },
    throwOnError: true,
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data.data;
}

export async function probeModelCapabilities(input: {
  features: Array<
    "audio" | "json" | "reasoning" | "streaming" | "tools" | "vision"
  >;
  modelId: string;
  signal?: AbortSignal;
}) {
  configureBrowserApiClients();
  const response = await modelsProbe({
    body: { features: input.features },
    path: { modelId: input.modelId },
    throwOnError: true,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return response.data.data;
}

export async function previewModelCompatibility(input: {
  modelId: string;
  required: {
    attachments: boolean;
    imageOutput: boolean;
    localOnly: boolean;
    reasoning: boolean;
    tools: boolean;
  };
}) {
  configureBrowserApiClients();
  const response = await modelsCompatibilityPreview({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function syncProviderModels(
  providerId: string,
): Promise<BaseModel[]> {
  configureBrowserApiClients();
  const response = await providersSyncModels({
    path: { providerId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function pullOllamaProviderModel(input: {
  model: string;
  providerId: string;
}): Promise<OllamaPullResult> {
  configureBrowserApiClients();
  const response = await providersPullOllamaModel({
    path: { providerId: input.providerId },
    body: { model: input.model },
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteOllamaProviderModel(input: {
  model: string;
  providerId: string;
}): Promise<OllamaDeleteResult> {
  configureBrowserApiClients();
  const response = await providersDeleteOllamaModel({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateModelCapabilities(input: {
  modelId: string;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  defaultParameters?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}): Promise<BaseModel> {
  configureBrowserApiClients();
  const response = await providersUpdateModelCapabilities({
    path: { modelId: input.modelId },
    body: {
      capabilities: input.capabilities,
      contextWindow: input.contextWindow,
      ...(input.defaultParameters === undefined
        ? {}
        : { defaultParameters: input.defaultParameters }),
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateModelEnabled(input: {
  modelId: string;
  enabled: boolean;
}): Promise<BaseModel> {
  configureBrowserApiClients();
  const response = await providersUpdateModelEnabled({
    path: { modelId: input.modelId },
    body: { enabled: input.enabled },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateModelPricing(input: {
  inputTokenUsd: number;
  modelId: string;
  outputTokenUsd: number;
  imageGenerationUsd?: {
    "1024x1024": number;
    "1024x1536": number;
    "1536x1024": number;
  };
}): Promise<BaseModel> {
  configureBrowserApiClients();
  const response = await providersUpdateModelPricing({
    path: { modelId: input.modelId },
    body: {
      inputTokenUsd: input.inputTokenUsd,
      outputTokenUsd: input.outputTokenUsd,
      ...(input.imageGenerationUsd === undefined
        ? {}
        : { imageGenerationUsd: input.imageGenerationUsd }),
    },
    throwOnError: true,
  });
  return response.data.data;
}
