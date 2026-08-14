import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiQueryKeys } from "../../lib/api-query-options";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  pullProviderModelMutationOptions,
  updateProviderModelMutationOptions,
  updateProviderMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  deleteOllamaProviderModel: vi.fn(),
  pullOllamaProviderModel: vi.fn(),
  syncProviderModels: vi.fn(),
  updateModelCapabilities: vi.fn(),
  updateModelEnabled: vi.fn(),
  updateModelPricing: vi.fn(),
  updateProvider: vi.fn(),
  verifyProvider: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

describe("provider mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("invalidates only the exact provider inventory after an update", async () => {
    const client = createRomeoQueryClient();
    const providerKey = apiQueryKeys.providers();
    const providerChildKey = [...providerKey, "detail"] as const;
    const modelKey = apiQueryKeys.models();
    const summaryKey = apiQueryKeys.providerOperationalSummary();
    const providerReportKey =
      apiQueryKeys.providerCapabilityReport("provider-1");
    const modelReportKey =
      apiQueryKeys.providerModelCapabilityReport("model-1");
    client.setQueryData(providerKey as readonly unknown[], { data: [] });
    client.setQueryData(providerChildKey as readonly unknown[], {
      id: "provider-1",
    });
    client.setQueryData(modelKey as readonly unknown[], { data: [] });
    client.setQueryData(summaryKey as readonly unknown[], { data: {} });
    client.setQueryData(providerReportKey as readonly unknown[], { data: {} });
    client.setQueryData(modelReportKey as readonly unknown[], { data: {} });
    mutationMocks.updateProvider.mockResolvedValueOnce({ id: "provider-1" });
    const observer = new MutationObserver(
      client,
      updateProviderMutationOptions(),
    );

    await observer.mutate({ enabled: true, providerId: "provider-1" });

    expect(client.getQueryState(providerKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(modelKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(providerReportKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(modelReportKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(providerChildKey)?.isInvalidated).toBe(false);
  });

  it("pulls and synchronizes a provider model in the same session", async () => {
    const client = createRomeoQueryClient();
    mutationMocks.pullOllamaProviderModel.mockResolvedValueOnce({
      model: "llama-enterprise",
    });
    mutationMocks.syncProviderModels.mockResolvedValueOnce([]);
    const observer = new MutationObserver(
      client,
      pullProviderModelMutationOptions(),
    );

    await observer.mutate({
      model: "llama-enterprise",
      providerId: "provider-1",
    });

    expect(mutationMocks.syncProviderModels).toHaveBeenCalledWith("provider-1");
  });

  it("refreshes only the affected model and provider capability evidence", async () => {
    const client = createRomeoQueryClient();
    const modelKey = apiQueryKeys.models();
    const modelReportKey =
      apiQueryKeys.providerModelCapabilityReport("model-1");
    const otherModelReportKey =
      apiQueryKeys.providerModelCapabilityReport("model-2");
    const providerReportKey =
      apiQueryKeys.providerCapabilityReport("provider-1");
    for (const key of [
      modelKey,
      modelReportKey,
      otherModelReportKey,
      providerReportKey,
    ]) {
      client.setQueryData(key as readonly unknown[], { data: {} });
    }
    mutationMocks.updateModelEnabled.mockResolvedValueOnce({
      id: "model-1",
      providerId: "provider-1",
    });
    const observer = new MutationObserver(
      client,
      updateProviderModelMutationOptions(),
    );

    await observer.mutate({ enabled: false, modelId: "model-1" });

    expect(client.getQueryState(modelKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(modelReportKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(providerReportKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherModelReportKey)?.isInvalidated).toBe(
      false,
    );
  });

  it("does not synchronize or invalidate when a pull resolves after logout", async () => {
    const client = createRomeoQueryClient();
    let resolvePull!: (value: { model: string }) => void;
    mutationMocks.pullOllamaProviderModel.mockReturnValueOnce(
      new Promise<{ model: string }>((resolve) => {
        resolvePull = resolve;
      }),
    );
    mutationMocks.syncProviderModels.mockResolvedValueOnce([]);
    const observer = new MutationObserver(
      client,
      pullProviderModelMutationOptions(),
    );
    const mutation = observer.mutate({
      model: "llama-enterprise",
      providerId: "provider-1",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.pullOllamaProviderModel).toHaveBeenCalledOnce(),
    );

    await clearRouteDataForLogout(client);
    client.setQueryData(apiQueryKeys.providers() as readonly unknown[], {
      data: [],
    });
    resolvePull({ model: "llama-enterprise" });
    await mutation;

    expect(mutationMocks.syncProviderModels).not.toHaveBeenCalled();
    expect(client.getQueryState(apiQueryKeys.providers())?.isInvalidated).toBe(
      false,
    );
  });
});
