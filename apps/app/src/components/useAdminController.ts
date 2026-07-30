import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProvider,
  deleteOllamaProviderModel,
  pullOllamaProviderModel,
  syncProviderModels,
  updateModelPricing,
  updateModelCapabilities,
  updateModelEnabled,
  updateProvider,
  verifyProvider,
} from "../features/providers/mutations";
import { createManagedSecret } from "../features/auth-provider-administration";
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
  const [pullingProviderId, setPullingProviderId] = useState<string>();
  const [deletingModelId, setDeletingModelId] = useState<string>();

  const createProviderMutation = useMutation({ mutationFn: createProvider });
  const updateModelPricingMutation = useMutation({
    mutationFn: updateModelPricing,
  });
  const updateModelMutation = useMutation({
    mutationFn: async (
      input:
        | Parameters<typeof updateModelCapabilities>[0]
        | Parameters<typeof updateModelEnabled>[0],
    ) =>
      "capabilities" in input
        ? updateModelCapabilities(input)
        : updateModelEnabled(input),
  });
  const updateProviderMutation = useMutation({ mutationFn: updateProvider });
  const verifyProviderMutation = useMutation({ mutationFn: verifyProvider });

  async function handleCreateProvider(
    input: Parameters<typeof createProvider>[0],
  ) {
    setError(undefined);
    try {
      const { apiKey, ...providerInput } = input as typeof input & {
        apiKey?: string;
      };
      let credentialRef = providerInput.credentialRef;
      if (apiKey?.trim()) {
        const secret = await createManagedSecret({
          purpose: "model_provider_credential",
          scope: "org",
          value: apiKey.trim(),
          name: `${providerInput.name} API key`,
        });
        credentialRef = secret.secretRef;
      }
      const provider = await createProviderMutation.mutateAsync({
        ...providerInput,
        ...(credentialRef === undefined ? {} : { credentialRef }),
      });
      setSyncingProviderId(provider.id);
      try {
        await syncProviderModels(provider.id);
      } catch (caught) {
        setError(
          `Connection saved, but model refresh failed: ${caught instanceof Error ? caught.message : "Unable to reach the model endpoint."}`,
        );
      } finally {
        setSyncingProviderId(undefined);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create provider.",
      );
      throw caught;
    }
  }

  async function handleUpdateModel(
    input:
      | Parameters<typeof updateModelCapabilities>[0]
      | Parameters<typeof updateModelEnabled>[0],
  ) {
    setError(undefined);
    try {
      await updateModelMutation.mutateAsync(input);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to update model.",
      );
      throw caught;
    }
  }

  async function handleSyncProvider(providerId: string) {
    setError(undefined);
    setSyncingProviderId(providerId);
    try {
      await syncProviderModels(providerId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
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
      throw caught;
    } finally {
      setSyncingProviderId(undefined);
    }
  }

  async function handlePullProviderModel(providerId: string, model: string) {
    setError(undefined);
    setPullingProviderId(providerId);
    try {
      const result = await pullOllamaProviderModel({ providerId, model });
      await syncProviderModels(providerId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
      return result;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to pull the Ollama model.",
      );
      throw caught;
    } finally {
      setPullingProviderId(undefined);
    }
  }

  async function handleDeleteProviderModel(
    providerId: string,
    modelId: string,
    model: string,
  ) {
    setError(undefined);
    setDeletingModelId(modelId);
    try {
      const result = await deleteOllamaProviderModel({ providerId, model });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
      return result;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete the Ollama model.",
      );
      throw caught;
    } finally {
      setDeletingModelId(undefined);
    }
  }

  async function handleUpdateProvider(
    input: Parameters<typeof updateProvider>[0] & {
      apiKey?: string;
      refreshModels?: boolean;
    },
  ) {
    const { apiKey, refreshModels = false, ...providerInput } = input;
    try {
      let credentialRef = providerInput.credentialRef;
      if (apiKey?.trim()) {
        const provider = data.providers.find(
          (item) => item.id === input.providerId,
        );
        const secret = await createManagedSecret({
          purpose: "model_provider_credential",
          scope: "org",
          value: apiKey.trim(),
          name: `${provider?.name ?? "Provider"} API key`,
        });
        credentialRef = secret.secretRef;
      }
      await updateProviderMutation.mutateAsync({
        ...providerInput,
        ...(credentialRef === undefined ? {} : { credentialRef }),
      });
      setError(undefined);
      if (refreshModels) {
        setSyncingProviderId(input.providerId);
        try {
          await syncProviderModels(input.providerId);
        } catch (caught) {
          setError(
            `Connection saved, but model refresh failed: ${caught instanceof Error ? caught.message : "Unable to reach the model endpoint."}`,
          );
        } finally {
          setSyncingProviderId(undefined);
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update the provider.",
      );
      throw caught;
    }
  }

  async function handleVerifyProvider(providerId: string) {
    setError(undefined);
    return verifyProviderMutation.mutateAsync(providerId);
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
      throw caught;
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
    isUpdatingModel: updateModelMutation.isPending,
    isUpdatingProvider: updateProviderMutation.isPending,
    verifyingProviderId: verifyProviderMutation.variables,
    syncingProviderId,
    pullingProviderId,
    deletingModelId,
    handleCreateProvider,
    handleSyncProvider,
    handlePullProviderModel,
    handleDeleteProviderModel,
    handleUpdateModelPricing,
    handleUpdateModel,
    handleUpdateProvider,
    handleVerifyProvider,
    handleChatArchived,
    handleChatDeleted,
    handleWorkspaceArchived,
  };
}
