import {
  assertRunAuthorized,
  AuthorizationError,
  type AuthSubject,
} from "@romeo/auth";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";

export type ModelRoutingMode = "selected" | "economy";

export interface ModelRoutingDecision {
  candidateCount: number;
  estimatedBlendedTokenUsd?: number;
  mode: ModelRoutingMode;
  requestedModelId: string;
  selectedModelId: string;
}

export interface RoutedModelSelection {
  decision: ModelRoutingDecision;
  model: BaseModel;
  provider: ProviderInstance;
}

/**
 * Selects a lower-cost model without crossing the caller's grants or the
 * deployment/data boundary implied by the explicitly selected model. Romeo
 * deliberately does not infer a "quality" ranking from model names. Economy
 * routing only considers models that preserve every advertised capability,
 * modality and context window of the selected model.
 */
export async function routeModelSelection(
  repository: RomeoRepository,
  input: {
    agentId: string;
    chatId: string;
    disabledProviderIds?: ReadonlySet<string>;
    mode?: ModelRoutingMode;
    orgId: string;
    primaryModel: BaseModel;
    primaryProvider: ProviderInstance;
    subject: AuthSubject;
    workspaceId: string;
  },
): Promise<RoutedModelSelection> {
  const mode = input.mode ?? "selected";
  if (mode === "selected") return primarySelection(input, mode, 1);

  const [models, grants] = await Promise.all([
    repository.listModels(input.orgId),
    repository.listResourceGrants(input.subject.orgId),
  ]);
  const providerIds = [...new Set(models.map((model) => model.providerId))];
  const providers = new Map(
    (
      await Promise.all(
        providerIds.map((providerId) => repository.getProvider(providerId)),
      )
    )
      .filter(
        (provider): provider is ProviderInstance => provider !== undefined,
      )
      .map((provider) => [provider.id, provider]),
  );

  const candidates: Array<{
    model: BaseModel;
    provider: ProviderInstance;
    blendedPrice: number;
  }> = [];
  for (const model of models) {
    const provider = providers.get(model.providerId);
    if (
      provider === undefined ||
      provider.orgId !== input.orgId ||
      !provider.enabled ||
      input.disabledProviderIds?.has(provider.id) === true ||
      !model.enabled ||
      model.available === false ||
      !preservesSelectedModelBoundary(
        input.primaryModel,
        input.primaryProvider,
        model,
        provider,
      )
    )
      continue;
    const blendedPrice = blendedTokenPrice(model);
    if (blendedPrice === undefined) continue;
    try {
      assertRunAuthorized({
        subject: input.subject,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        agentId: input.agentId,
        modelId: model.id,
        providerId: provider.id,
        grants,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) continue;
      throw error;
    }
    candidates.push({ model, provider, blendedPrice });
  }

  candidates.sort(
    (left, right) =>
      left.blendedPrice - right.blendedPrice ||
      left.model.id.localeCompare(right.model.id),
  );
  const selected = candidates[0];
  if (selected === undefined) return primarySelection(input, mode, 0);
  return {
    model: selected.model,
    provider: selected.provider,
    decision: {
      candidateCount: candidates.length,
      estimatedBlendedTokenUsd: selected.blendedPrice,
      mode,
      requestedModelId: input.primaryModel.id,
      selectedModelId: selected.model.id,
    },
  };
}

function primarySelection(
  input: Parameters<typeof routeModelSelection>[1],
  mode: ModelRoutingMode,
  candidateCount: number,
): RoutedModelSelection {
  const estimatedBlendedTokenUsd = blendedTokenPrice(input.primaryModel);
  return {
    model: input.primaryModel,
    provider: input.primaryProvider,
    decision: {
      candidateCount,
      ...(estimatedBlendedTokenUsd === undefined
        ? {}
        : { estimatedBlendedTokenUsd }),
      mode,
      requestedModelId: input.primaryModel.id,
      selectedModelId: input.primaryModel.id,
    },
  };
}

function blendedTokenPrice(model: BaseModel): number | undefined {
  const pricing = model.pricing;
  if (
    pricing === undefined ||
    !Number.isFinite(pricing.inputTokenUsd) ||
    pricing.inputTokenUsd < 0 ||
    !Number.isFinite(pricing.outputTokenUsd) ||
    pricing.outputTokenUsd < 0
  )
    return undefined;
  // A documented routing estimate, not billing: typical text workloads are
  // input-heavy, so use an 80/20 input/output blend for deterministic ranking.
  return pricing.inputTokenUsd * 0.8 + pricing.outputTokenUsd * 0.2;
}

function preservesSelectedModelBoundary(
  selected: BaseModel,
  selectedProvider: ProviderInstance,
  candidate: BaseModel,
  candidateProvider: ProviderInstance,
): boolean {
  if (candidate.contextWindow < selected.contextWindow) return false;
  if (
    candidateProvider.capabilities.deployment.mode !==
      selectedProvider.capabilities.deployment.mode ||
    candidateProvider.capabilities.deployment.networkAccess !==
      selectedProvider.capabilities.deployment.networkAccess
  )
    return false;
  const selectedCapabilities = selected.capabilities;
  const candidateCapabilities = candidate.capabilities;
  if (
    (selectedCapabilities.streaming && !candidateCapabilities.streaming) ||
    (selectedCapabilities.toolCalling && !candidateCapabilities.toolCalling) ||
    (selectedCapabilities.vision && !candidateCapabilities.vision) ||
    (selectedCapabilities.audioInput && !candidateCapabilities.audioInput) ||
    (selectedCapabilities.structuredJson &&
      !candidateCapabilities.structuredJson) ||
    (selectedCapabilities.reasoning && !candidateCapabilities.reasoning) ||
    (selectedCapabilities.imageGeneration === true &&
      candidateCapabilities.imageGeneration !== true)
  )
    return false;
  const modalities = new Set(candidateCapabilities.modalities);
  return selectedCapabilities.modalities.every((value) =>
    modalities.has(value),
  );
}
