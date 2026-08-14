import { getProviderDialectSummary, type ProviderInstance } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { decorateCatalogModels } from "./catalog-model-decorator";
import {
  publicProviderConnectionExtras,
  readProviderConnectionExtrasById,
  type ProviderConnectionExtras,
} from "./provider-connection-extras";
import { parseManagedSecretRef } from "./secret-refs";

export async function toProviderResponses(
  repository: RomeoRepository,
  orgId: string,
  providers: ProviderInstance[],
) {
  const extras = await readProviderConnectionExtrasById(repository, orgId);
  return providers.map((provider) =>
    toProviderResponse(provider, extras.get(provider.id)),
  );
}

export function toProviderResponse(
  provider: ProviderInstance,
  extras?: ProviderConnectionExtras,
) {
  const { credentialRef: _credentialRef, ...safeProvider } = provider;
  const scheme = credentialRefScheme(provider.credentialRef);
  const { kind: _kind, ...dialect } = getProviderDialectSummary(provider.type);
  return {
    ...safeProvider,
    credentialConfigured: provider.credentialRef !== undefined,
    dialect,
    ...(scheme === undefined ? {} : { credentialRefScheme: scheme }),
    ...(extras === undefined ? {} : publicProviderConnectionExtras(extras)),
  };
}

export function decorateListedModels(
  repository: RomeoRepository,
  orgId: string,
  models: Parameters<typeof decorateCatalogModels>[2],
) {
  return decorateCatalogModels(repository, orgId, models);
}

function credentialRefScheme(
  credentialRef: string | undefined,
): string | undefined {
  if (credentialRef === undefined) return undefined;
  try {
    return parseManagedSecretRef(credentialRef).scheme;
  } catch {
    return "invalid";
  }
}
