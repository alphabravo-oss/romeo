import { useMutation, type QueryClient } from "@tanstack/react-query";
import { useState, type Dispatch, type SetStateAction } from "react";

import { cloneAgent } from "../features/managed-models";
import {
  createProvider,
  syncProviderModels,
  updateModelPricing,
} from "../features/providers/mutations";

interface WorkspaceProviderActionsOptions {
  activeAgent: { id: string; name: string } | undefined;
  queryClient: QueryClient;
  setActiveAgentId: Dispatch<SetStateAction<string | undefined>>;
  setError: (error: string | undefined) => void;
  workspaceId: string | undefined;
}

export function useWorkspaceProviderActions({
  activeAgent,
  queryClient,
  setActiveAgentId,
  setError,
  workspaceId,
}: WorkspaceProviderActionsOptions) {
  const [syncingProviderId, setSyncingProviderId] = useState<string>();
  const cloneAgentMutation = useMutation({ mutationFn: cloneAgent });
  const createProviderMutation = useMutation({ mutationFn: createProvider });
  const updateModelPricingMutation = useMutation({
    mutationFn: updateModelPricing,
  });

  async function handleCloneAgent() {
    if (activeAgent === undefined || workspaceId === undefined) return;
    setError(undefined);
    try {
      const cloned = await cloneAgentMutation.mutateAsync({
        agentId: activeAgent.id,
        name: `${activeAgent.name} copy`,
      });
      setActiveAgentId(cloned.id);
      await queryClient.invalidateQueries({
        queryKey: ["agents", workspaceId],
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to clone agent.",
      );
    }
  }

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
    handleCloneAgent,
    handleCreateProvider,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCloningAgent: cloneAgentMutation.isPending,
    isCreatingProvider: createProviderMutation.isPending,
    isUpdatingModelPricing: updateModelPricingMutation.isPending,
    syncingProviderId,
  };
}
