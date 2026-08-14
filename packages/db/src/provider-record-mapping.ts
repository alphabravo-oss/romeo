import type { ModelDefaultParameters } from "@romeo/providers";

import { asProviderCatalogSyncState } from "./provider-catalog-record";
import type {
  BaseModelRecord,
  ModelModality,
  ModelPricing,
  ProviderCapabilities,
  ProviderDeploymentConstraints,
  ProviderRecord,
} from "./provider-repository";
import { baseModels, providerInstances } from "./schema";

export function toProviderRecord(
  row: typeof providerInstances.$inferSelect,
): ProviderRecord {
  const catalogSync = asProviderCatalogSyncState(row.catalogSync);
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    ...(row.credentialRef === null ? {} : { credentialRef: row.credentialRef }),
    ...(Array.isArray(row.modelIds)
      ? {
          modelIds: row.modelIds.filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
    enabled: row.enabled,
    capabilities: asProviderCapabilities(row.capabilities),
    ...(catalogSync === undefined ? {} : { catalogSync }),
  };
}

export function toBaseModelRecord(
  row: typeof baseModels.$inferSelect,
): BaseModelRecord {
  const model: BaseModelRecord = {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    displayName: row.displayName,
    enabled: row.enabled,
    available: row.available,
    capabilities: asProviderCapabilities(row.capabilities),
    contextWindow: row.contextWindow,
    capabilitiesSource:
      row.capabilitiesSource === "override" ? "override" : "detected",
  };
  const pricing = asModelPricing(row.pricing);
  if (pricing !== undefined) model.pricing = pricing;
  const defaultParameters = asModelDefaultParameters(row.defaultParameters);
  if (defaultParameters !== undefined)
    model.defaultParameters = defaultParameters;
  return model;
}

export function toProviderInsert(
  record: ProviderRecord,
): typeof providerInstances.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    type: record.type,
    name: record.name,
    baseUrl: record.baseUrl,
    credentialRef: record.credentialRef ?? null,
    modelIds: record.modelIds ?? null,
    capabilities: record.capabilities,
    catalogSync: record.catalogSync ?? null,
    enabled: record.enabled,
  };
}

export function toBaseModelInsert(
  record: BaseModelRecord,
  orgId: string,
): typeof baseModels.$inferInsert {
  return {
    id: record.id,
    orgId,
    providerId: record.providerId,
    name: record.name,
    displayName: record.displayName,
    capabilities: record.capabilities,
    capabilitiesSource: record.capabilitiesSource ?? "detected",
    contextWindow: record.contextWindow,
    pricing: record.pricing ?? null,
    defaultParameters: record.defaultParameters ?? null,
    enabled: record.enabled,
    available: record.available ?? true,
  };
}

function asProviderCapabilities(value: unknown): ProviderCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return conservativeCapabilities();
  const input = value as Record<string, unknown>;
  return {
    streaming: input.streaming === true,
    toolCalling: input.toolCalling === true,
    vision: input.vision === true,
    audioInput: input.audioInput === true,
    structuredJson: input.structuredJson === true,
    reasoning: input.reasoning === true,
    imageGeneration: input.imageGeneration === true,
    modalities: asModalities(input.modalities),
    deployment: asDeploymentConstraints(input.deployment),
  };
}

function asDeploymentConstraints(
  value: unknown,
): ProviderDeploymentConstraints {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return conservativeCapabilities().deployment;
  const input = value as Record<string, unknown>;
  return {
    mode: input.mode === "local-runtime" ? "local-runtime" : "hosted-api",
    networkAccess:
      input.networkAccess === "local-http" ? "local-http" : "external-http",
    credentialRequired: input.credentialRequired !== false,
  };
}

function asModalities(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ModelModality>([
    "audio-input",
    "audio-output",
    "embeddings",
    "text",
    "vision",
  ]);
  return [
    ...new Set(
      value.filter((item): item is ModelModality =>
        allowed.has(item as ModelModality),
      ),
    ),
  ];
}

function asModelPricing(value: unknown): ModelPricing | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.inputTokenUsd !== "number" ||
    typeof input.outputTokenUsd !== "number" ||
    !Number.isFinite(input.inputTokenUsd) ||
    !Number.isFinite(input.outputTokenUsd)
  )
    return undefined;
  const imageGenerationUsd = asImageGenerationPricing(input.imageGenerationUsd);
  if (
    input.imageGenerationUsd !== undefined &&
    imageGenerationUsd === undefined
  )
    return undefined;
  return {
    inputTokenUsd: input.inputTokenUsd,
    outputTokenUsd: input.outputTokenUsd,
    ...(imageGenerationUsd === undefined ? {} : { imageGenerationUsd }),
  };
}

function asModelDefaultParameters(
  value: unknown,
): ModelDefaultParameters | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const parameters: ModelDefaultParameters = {};
  if (
    typeof input.temperature === "number" &&
    Number.isFinite(input.temperature)
  )
    parameters.temperature = input.temperature;
  if (typeof input.topP === "number" && Number.isFinite(input.topP))
    parameters.topP = input.topP;
  if (
    typeof input.maxOutputTokens === "number" &&
    Number.isInteger(input.maxOutputTokens) &&
    input.maxOutputTokens > 0
  )
    parameters.maxOutputTokens = input.maxOutputTokens;
  return Object.keys(parameters).length === 0 ? undefined : parameters;
}

function asImageGenerationPricing(
  value: unknown,
): ModelPricing["imageGenerationUsd"] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const square = input["1024x1024"];
  const portrait = input["1024x1536"];
  const landscape = input["1536x1024"];
  if (
    typeof square !== "number" ||
    typeof portrait !== "number" ||
    typeof landscape !== "number" ||
    !Number.isFinite(square) ||
    !Number.isFinite(portrait) ||
    !Number.isFinite(landscape)
  )
    return undefined;
  return {
    "1024x1024": square,
    "1024x1536": portrait,
    "1536x1024": landscape,
  };
}

function conservativeCapabilities(): ProviderCapabilities {
  return {
    streaming: false,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    imageGeneration: false,
    modalities: [],
    deployment: {
      mode: "hosted-api",
      networkAccess: "external-http",
      credentialRequired: true,
    },
  };
}
