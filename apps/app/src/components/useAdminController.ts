import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProviderMutationOptions,
  deleteProviderModelMutationOptions,
  pullProviderModelMutationOptions,
  syncProviderModelsMutationOptions,
  updateModelPricingMutationOptions,
  updateProviderModelMutationOptions,
  updateProviderMutationOptions,
  verifyProviderMutationOptions,
  type UpdateProviderModelInput,
} from "../features/providers/mutation-options";
import type {
  createProvider,
  updateModelPricing,
  updateProvider,
} from "../features/providers/mutations";
import { createManagedSecret } from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import * as appQueryKeys from "../lib/app-query-keys";
import { apiQueryKeys } from "../lib/api-query-options";
import { useWorkspaceData } from "./useWorkspaceData";
import { removeChatCache } from "../features/chats/cache-policy";

/**
 * Focused controller for the admin route. Reuses the cached workspace
 * queries (providers/models/workspace/subject) and owns only the mutations
 * the admin panels need — deliberately NOT the full chat controller, which
 * would trigger chat/message fetches irrelevant to admin.
 */
export function useAdminController() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  // Drafts included: the admin curated table is where a model is created, and the gallery query
  // lists published models only -- so a model created here was invisible the moment it was made,
  // and the "drafts" tile above the table could only ever read zero.
  const data = useWorkspaceData(undefined, { includeDrafts: true });
  const [error, setError] = useState<string>();
  const [syncingProviderId, setSyncingProviderId] = useState<string>();
  const [pullingProviderId, setPullingProviderId] = useState<string>();
  const [deletingModelId, setDeletingModelId] = useState<string>();

  const createProviderMutation = useMutation(createProviderMutationOptions());
  const syncProviderModelsMutation = useMutation(
    syncProviderModelsMutationOptions(),
  );
  const pullProviderModelMutation = useMutation(
    pullProviderModelMutationOptions(),
  );
  const deleteProviderModelMutation = useMutation(
    deleteProviderModelMutationOptions(),
  );
  const updateModelPricingMutation = useMutation(
    updateModelPricingMutationOptions(),
  );
  const updateModelMutation = useMutation(updateProviderModelMutationOptions());
  const updateProviderMutation = useMutation(updateProviderMutationOptions());
  const verifyProviderMutation = useMutation(verifyProviderMutationOptions());

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
        await syncProviderModelsMutation.mutateAsync(provider.id);
      } catch (caught) {
        setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      } finally {
        setSyncingProviderId(undefined);
      }
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      throw caught;
    }
  }

  async function handleUpdateModel(input: UpdateProviderModelInput) {
    setError(undefined);
    try {
      await updateModelMutation.mutateAsync(input);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      throw caught;
    }
  }

  async function handleSyncProvider(providerId: string) {
    setError(undefined);
    setSyncingProviderId(providerId);
    try {
      await syncProviderModelsMutation.mutateAsync(providerId);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      throw caught;
    } finally {
      setSyncingProviderId(undefined);
    }
  }

  async function handlePullProviderModel(providerId: string, model: string) {
    setError(undefined);
    setPullingProviderId(providerId);
    try {
      const result = await pullProviderModelMutation.mutateAsync({
        providerId,
        model,
      });
      return result;
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
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
      const result = await deleteProviderModelMutation.mutateAsync({
        providerId,
        model,
      });
      return result;
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
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
          await syncProviderModelsMutation.mutateAsync(input.providerId);
        } catch (caught) {
          setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
        } finally {
          setSyncingProviderId(undefined);
        }
      }
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      throw caught;
    }
  }

  async function handleVerifyProvider(
    providerId: string,
    signal?: AbortSignal,
  ) {
    setError(undefined);
    return verifyProviderMutation.mutateAsync({
      providerId,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async function handleUpdateModelPricing(
    input: Parameters<typeof updateModelPricing>[0],
  ) {
    setError(undefined);
    try {
      await updateModelPricingMutation.mutateAsync(input);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("unexpectedAsyncFailure")));
      throw caught;
    }
  }

  // Governance actions on an admin page have no local chat state — just
  // refresh the affected server data.
  async function handleChatArchived(chatId: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chat(chatId),
      }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chats(data.workspace?.id),
      }),
    ]);
  }
  async function handleChatDeleted(chatId: string) {
    removeChatCache(queryClient, chatId);
    await queryClient.invalidateQueries({
      exact: true,
      queryKey: appQueryKeys.chats(data.workspace?.id),
    });
  }
  async function handleWorkspaceArchived(workspaceId: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        exact: true,
        queryKey: apiQueryKeys.bootstrap(),
      }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chats(workspaceId),
      }),
    ]);
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
    verifyingProviderId: verifyProviderMutation.variables?.providerId,
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
