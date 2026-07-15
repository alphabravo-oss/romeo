import type { ProviderFallbackTarget } from "@romeo/ai-runtime";
import {
  getProviderAdapter,
  type BaseModel,
  type ProviderInstance,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";

export interface ProviderRoutingPolicy {
  disabledProviderIds: ReadonlySet<string>;
  fallbackModelId?: string;
}

export interface ProviderRoutePlan {
  fallback?: ProviderFallbackTarget;
  primaryDisabled: boolean;
}

export function createProviderRoutingPolicy(input: {
  disabledProviderIds?: string | undefined;
  fallbackModelId?: string | undefined;
}): ProviderRoutingPolicy {
  const fallbackModelId = normalToken(input.fallbackModelId);
  return {
    disabledProviderIds: parseDisabledProviderIds(input.disabledProviderIds),
    ...(fallbackModelId === undefined ? {} : { fallbackModelId }),
  };
}

export async function createProviderRoutePlan(
  repository: RomeoRepository,
  policy: ProviderRoutingPolicy,
  primary: { model: BaseModel; provider: ProviderInstance },
): Promise<ProviderRoutePlan> {
  return {
    primaryDisabled: policy.disabledProviderIds.has(primary.provider.id),
    ...(await resolveFallback(repository, policy, primary)),
  };
}

function parseDisabledProviderIds(
  value: string | undefined,
): ReadonlySet<string> {
  if (value === undefined) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

async function resolveFallback(
  repository: RomeoRepository,
  policy: ProviderRoutingPolicy,
  primary: { model: BaseModel; provider: ProviderInstance },
): Promise<Pick<ProviderRoutePlan, "fallback">> {
  if (policy.fallbackModelId === undefined) return {};
  if (policy.fallbackModelId === primary.model.id) return {};

  const fallbackModel = await repository.getModel(policy.fallbackModelId);
  if (fallbackModel === undefined || !fallbackModel.enabled) return {};

  const fallbackProvider = await repository.getProvider(
    fallbackModel.providerId,
  );
  if (fallbackProvider === undefined || !fallbackProvider.enabled) return {};
  if (fallbackProvider.orgId !== primary.provider.orgId) return {};
  if (policy.disabledProviderIds.has(fallbackProvider.id)) return {};

  return {
    fallback: {
      adapter: getProviderAdapter(fallbackProvider.type),
      model: fallbackModel,
      provider: fallbackProvider,
    },
  };
}

function normalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
