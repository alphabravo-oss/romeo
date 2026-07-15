import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  createProviderRoutePlan,
  createProviderRoutingPolicy,
} from "./provider-routing";

describe("provider routing", () => {
  it("resolves an enabled fallback model when the primary provider is disabled", async () => {
    const repository = new InMemoryRomeoRepository();
    const primaryProvider = required(
      await repository.getProvider("provider_openai_compatible"),
    );
    const primaryModel = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const fallbackProvider = required(
      await repository.getProvider("provider_ollama"),
    );
    const fallbackModel = required(
      await repository.getModel("model_ollama_default"),
    );

    const plan = await createProviderRoutePlan(
      repository,
      createProviderRoutingPolicy({
        disabledProviderIds: " provider_openai_compatible ",
        fallbackModelId: fallbackModel.id,
      }),
      {
        model: primaryModel,
        provider: primaryProvider,
      },
    );

    expect(plan.primaryDisabled).toBe(true);
    expect(plan.fallback?.provider.id).toBe(fallbackProvider.id);
    expect(plan.fallback?.model.id).toBe(fallbackModel.id);
  });

  it("does not route to a disabled fallback provider", async () => {
    const repository = new InMemoryRomeoRepository();
    const primaryProvider = required(
      await repository.getProvider("provider_openai_compatible"),
    );
    const primaryModel = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const seededFallbackProvider = required(
      await repository.getProvider("provider_ollama"),
    );
    const seededFallbackModel = required(
      await repository.getModel("model_ollama_default"),
    );
    const fallbackProvider = await repository.createProvider({
      ...seededFallbackProvider,
      id: "provider_disabled_fallback",
      enabled: false,
    });
    const fallbackModel = required(
      (
        await repository.upsertModels([
          {
            ...seededFallbackModel,
            id: "model_disabled_fallback",
            providerId: fallbackProvider.id,
            enabled: true,
          },
        ])
      )[0],
    );

    const plan = await createProviderRoutePlan(
      repository,
      createProviderRoutingPolicy({
        fallbackModelId: fallbackModel.id,
      }),
      {
        model: primaryModel,
        provider: primaryProvider,
      },
    );

    expect(plan.primaryDisabled).toBe(false);
    expect(plan.fallback).toBeUndefined();
  });

  it("does not route to a kill-switched fallback provider", async () => {
    const repository = new InMemoryRomeoRepository();
    const primaryProvider = required(
      await repository.getProvider("provider_openai_compatible"),
    );
    const primaryModel = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const seededFallbackProvider = required(
      await repository.getProvider("provider_ollama"),
    );
    const seededFallbackModel = required(
      await repository.getModel("model_ollama_default"),
    );
    const fallbackProvider = await repository.createProvider({
      ...seededFallbackProvider,
      id: "provider_kill_switched_fallback",
    });
    const fallbackModel = required(
      (
        await repository.upsertModels([
          {
            ...seededFallbackModel,
            id: "model_kill_switched_fallback",
            providerId: fallbackProvider.id,
            enabled: true,
          },
        ])
      )[0],
    );

    const plan = await createProviderRoutePlan(
      repository,
      createProviderRoutingPolicy({
        disabledProviderIds: fallbackProvider.id,
        fallbackModelId: fallbackModel.id,
      }),
      {
        model: primaryModel,
        provider: primaryProvider,
      },
    );

    expect(plan.primaryDisabled).toBe(false);
    expect(plan.fallback).toBeUndefined();
  });
});

function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
