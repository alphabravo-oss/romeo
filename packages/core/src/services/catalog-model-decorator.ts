import type { BaseModel } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import {
  catalogModelSurface,
  type CatalogModelSurface,
} from "./catalog-model-surface";
import { readModelProbeTimestamps } from "./model-capability-probe";
import { readProviderConnectionExtrasById } from "./provider-connection-extras";

export type CatalogDecoratedModel = BaseModel & {
  catalogSurface: CatalogModelSurface;
  probedAt?: string;
};

export async function decorateCatalogModels(
  repository: RomeoRepository,
  orgId: string,
  models: BaseModel[],
): Promise<CatalogDecoratedModel[]> {
  if (models.length === 0) return [];
  const [providers, extras, probes] = await Promise.all([
    repository.listProviders(orgId),
    readProviderConnectionExtrasById(repository, orgId),
    readModelProbeTimestamps(repository, orgId),
  ]);
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  return models.map((model) => {
    const provider = providerById.get(model.providerId);
    const probedAt = probes.get(model.id);
    const region = extras.get(model.providerId)?.region;
    return {
      ...model,
      catalogSurface: catalogModelSurface({
        deploymentMode:
          provider?.capabilities.deployment.mode ??
          model.capabilities.deployment.mode,
        model,
        ...(probedAt === undefined ? {} : { probedAt }),
        ...(region === undefined ? {} : { region }),
      }),
      ...(probedAt === undefined ? {} : { probedAt }),
    };
  });
}
