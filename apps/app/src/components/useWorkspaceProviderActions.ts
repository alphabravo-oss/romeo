import { useMutation, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProvider,
  syncProviderModels,
  updateModelPricing,
} from "../features/providers/mutations";

interface WorkspaceProviderActionsOptions {
  queryClient: QueryClient;
  setError: (error: string | undefined) => void;
}

export function useWorkspaceProviderActions({
  queryClient,
  setError,
}: WorkspaceProviderActionsOptions) {
  const [syncingProviderId, setSyncingProviderId] = useState<string>();
  const createProviderMutation = useMutation({ mutationFn: createProvider });
  const updateModelPricingMutation = useMutation({
    mutationFn: updateModelPricing,
  });

  async function handleCreateProvider(
    input: Parameters<typeof createProvider>[0],
  ) {
    setError(undefined);
    try {
      await createProviderMutation.mutateAsync(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create provider.",
      );
    }
  }

  async function handleSyncProvider(providerId: string) {
    setError(undefined);
    setSyncingProviderId(providerId);
    try {
      await syncProviderModels(providerId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sync provider models.",
      );
    } finally {
      setSyncingProviderId(undefined);
    }
  }

  async function handleUpdateModelPricing(
    input: Parameters<typeof updateModelPricing>[0],
  ) {
    setError(undefined);
    try {
      await updateModelPricingMutation.mutateAsync(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update model pricing.",
      );
    }
  }

  return {
    handleCreateProvider,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCreatingProvider: createProviderMutation.isPending,
    isUpdatingModelPricing: updateModelPricingMutation.isPending,
    syncingProviderId,
  };
}
