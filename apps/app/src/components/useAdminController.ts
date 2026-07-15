import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProvider,
  syncProviderModels,
  updateModelPricing,
} from "../api/client";
import { useWorkspaceData } from "./useWorkspaceData";

/**
 * Focused controller for the admin route. Reuses the cached workspace
 * queries (providers/models/workspace/subject) and owns only the mutations
 * the admin panels need — deliberately NOT the full chat controller, which
 * would trigger chat/message fetches irrelevant to admin.
 */
export function useAdminController() {
  const queryClient = useQueryClient();
  const data = useWorkspaceData(undefined);
  const [error, setError] = useState<string>();
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

  // Governance actions on an admin page have no local chat state — just
  // refresh the affected server data.
  async function handleChatArchived() {
    await queryClient.invalidateQueries();
  }
  async function handleChatDeleted() {
    await queryClient.invalidateQueries();
  }
  async function handleWorkspaceArchived() {
    await queryClient.invalidateQueries();
  }

  return {
    error,
    subject: data.subject,
    workspace: data.workspace,
    agents: data.agents,
    providers: data.providers,
    models: data.models,
    providerOperationalSummary: data.providerOperationalSummary,
    isCreatingProvider: createProviderMutation.isPending,
    isUpdatingModelPricing: updateModelPricingMutation.isPending,
    syncingProviderId,
    handleCreateProvider,
    handleSyncProvider,
    handleUpdateModelPricing,
    handleChatArchived,
    handleChatDeleted,
    handleWorkspaceArchived,
  };
}
