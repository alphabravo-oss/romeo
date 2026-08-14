import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProviderMutationOptions,
  syncProviderModelsMutationOptions,
  updateModelPricingMutationOptions,
} from "../features/providers/mutation-options";
import type {
  createProvider,
  updateModelPricing,
} from "../features/providers/mutations";
import { safeUserErrorMessage } from "../lib/safe-user-error";

interface WorkspaceProviderActionsOptions {
  setError: (error: string | undefined) => void;
}

export function useWorkspaceProviderActions({
  setError,
}: WorkspaceProviderActionsOptions) {
  const [syncingProviderId, setSyncingProviderId] = useState<string>();
  const createProviderMutation = useMutation(createProviderMutationOptions());
  const syncProviderModelsMutation = useMutation(
    syncProviderModelsMutationOptions(),
  );
  const updateModelPricingMutation = useMutation(
    updateModelPricingMutationOptions(),
  );

  async function handleCreateProvider(
    input: Parameters<typeof createProvider>[0],
  ) {
    setError(undefined);
    try {
      await createProviderMutation.mutateAsync(input);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, "Unable to create provider."));
    }
  }

  async function handleSyncProvider(providerId: string) {
    setError(undefined);
    setSyncingProviderId(providerId);
    try {
      await syncProviderModelsMutation.mutateAsync(providerId);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, "Unable to sync provider models."));
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
    } catch (caught) {
      setError(safeUserErrorMessage(caught, "Unable to update model pricing."));
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
