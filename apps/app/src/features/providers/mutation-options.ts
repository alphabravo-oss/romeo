import { apiQueryKeyRoots, apiQueryKeys } from "../../lib/api-query-options";
import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import { invalidateInventoriedTablePages } from "../../lib/inventoried-table-cache";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createProvider,
  deleteOllamaProviderModel,
  pullOllamaProviderModel,
  syncProviderModels,
  updateModelCapabilities,
  updateModelEnabled,
  updateModelPricing,
  updateProvider,
  verifyProvider,
} from "./mutations";

const providerInventoryInvalidations = (providerId: string) => [
  { exact: true as const, queryKey: apiQueryKeys.providers() },
  { exact: true as const, queryKey: apiQueryKeys.models() },
  {
    exact: true as const,
    queryKey: apiQueryKeys.providerCapabilityReport(providerId),
  },
  {
    exact: true as const,
    queryKey: apiQueryKeys.providerOperationalSummary(),
  },
];

export function createProviderMutationOptions() {
  return serverMutationOptions({
    resource: "provider.create",
    mutationFn: createProvider,
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.providers() },
      { exact: true, queryKey: apiQueryKeys.providerOperationalSummary() },
    ],
  });
}

export function syncProviderModelsMutationOptions() {
  return serverMutationOptions({
    resource: "provider.models.sync",
    mutationFn: syncProviderModels,
    reconcile: (client, _models, providerId) =>
      refreshProviderModelProjections(client, providerId),
    invalidations: (_data, providerId) =>
      providerInventoryInvalidations(providerId),
  });
}

export type UpdateProviderModelInput =
  | Parameters<typeof updateModelCapabilities>[0]
  | Parameters<typeof updateModelEnabled>[0];

export function updateProviderModelMutationOptions() {
  return serverMutationOptions({
    resource: "provider.model.update",
    mutationFn: (input: UpdateProviderModelInput) =>
      "capabilities" in input
        ? updateModelCapabilities(input)
        : updateModelEnabled(input),
    reconcile: (client, model) =>
      invalidateInventoriedTablePages(client, {
        parentId: model.providerId,
        resource: "provider_models",
      }),
    invalidations: (model, input) => [
      { exact: true, queryKey: apiQueryKeys.models() },
      {
        exact: true,
        queryKey: apiQueryKeys.providerCapabilityReport(model.providerId),
      },
      {
        exact: true,
        queryKey: apiQueryKeys.providerModelCapabilityReport(input.modelId),
      },
    ],
  });
}

export function updateProviderMutationOptions() {
  return serverMutationOptions({
    resource: "provider.update",
    mutationFn: updateProvider,
    reconcile: (client) =>
      invalidateCachedResourceExactly(
        client,
        apiQueryKeyRoots.providerModelCapabilityReports(),
      ),
    invalidations: (_data, input) =>
      providerInventoryInvalidations(input.providerId),
  });
}

export function verifyProviderMutationOptions() {
  return serverMutationOptions({
    resource: "provider.verify",
    mutationFn: (input: { providerId: string; signal?: AbortSignal }) =>
      verifyProvider(input.providerId, input.signal),
  });
}

export function pullProviderModelMutationOptions() {
  return serverMutationOptions({
    resource: "provider.ollamaModel.pull",
    mutationFn: async (
      input: Parameters<typeof pullOllamaProviderModel>[0],
    ) => {
      const sessionVersion = currentMutationSessionVersion();
      const result = await pullOllamaProviderModel(input);
      if (sessionVersion !== currentMutationSessionVersion()) return result;
      await syncProviderModels(input.providerId);
      return result;
    },
    reconcile: (client, _result, input) =>
      refreshProviderModelProjections(client, input.providerId),
    invalidations: (_data, input) =>
      providerInventoryInvalidations(input.providerId),
  });
}

export function deleteProviderModelMutationOptions() {
  return serverMutationOptions({
    resource: "provider.ollamaModel.delete",
    mutationFn: deleteOllamaProviderModel,
    reconcile: (client, _result, input) =>
      refreshProviderModelProjections(client, input.providerId),
    invalidations: (_data, input) =>
      providerInventoryInvalidations(input.providerId),
  });
}

async function refreshProviderModelProjections(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  providerId: string,
): Promise<void> {
  await Promise.all([
    invalidateCachedResourceExactly(
      client,
      apiQueryKeyRoots.providerModelCapabilityReports(),
    ),
    invalidateInventoriedTablePages(client, {
      parentId: providerId,
      resource: "provider_models",
    }),
  ]);
}

export function updateModelPricingMutationOptions() {
  return serverMutationOptions({
    resource: "provider.modelPricing.update",
    mutationFn: updateModelPricing,
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.models() },
      { exact: true, queryKey: appQueryKeys.usageSummary() },
    ],
  });
}
