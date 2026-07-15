import { apiJson } from "./http";
import type {
  BaseModel,
  Envelope,
  Provider,
  ProviderKind,
  ProviderOperationalSummary,
} from "./types";

export async function listProviders(): Promise<Provider[]> {
  const response = await apiJson<Envelope<Provider[]>>("/api/v1/providers");
  return response.data;
}

export async function listModels(): Promise<BaseModel[]> {
  const response = await apiJson<Envelope<BaseModel[]>>("/api/v1/models");
  return response.data;
}

export async function getProviderOperationalSummary(): Promise<ProviderOperationalSummary> {
  const response = await apiJson<Envelope<ProviderOperationalSummary>>(
    "/api/v1/providers/operational-summary",
  );
  return response.data;
}

export async function createProvider(input: {
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
}): Promise<Provider> {
  const response = await apiJson<Envelope<Provider>>("/api/v1/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function syncProviderModels(
  providerId: string,
): Promise<BaseModel[]> {
  const response = await apiJson<Envelope<BaseModel[]>>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/sync`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function updateModelPricing(input: {
  inputTokenUsd: number;
  modelId: string;
  outputTokenUsd: number;
}): Promise<BaseModel> {
  const response = await apiJson<Envelope<BaseModel>>(
    `/api/v1/models/${encodeURIComponent(input.modelId)}/pricing`,
    {
      method: "PATCH",
      body: JSON.stringify({
        inputTokenUsd: input.inputTokenUsd,
        outputTokenUsd: input.outputTokenUsd,
      }),
    },
  );
  return response.data;
}
