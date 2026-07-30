import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ProviderCatalogSyncCoordinator } from "./provider-catalog-sync";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_admins"],
  scopes: ["providers:read", "providers:write", "models:read", "admin:write"],
  isAdmin: true,
};

describe("provider catalog synchronization", () => {
  it("tracks provider availability without overwriting admin enablement", async () => {
    const repository = new InMemoryRomeoRepository();
    let remoteModels = ["one", "two"];
    const provider = await repository.createProvider({
      id: "provider_catalog_sync_test",
      orgId: subject.orgId,
      type: "openai-compatible",
      name: "Catalog sync test",
      baseUrl: "https://models.example.test/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("openai-compatible"),
      catalogSync: { status: "never", modelCount: 0 },
    });
    const coordinator = new ProviderCatalogSyncCoordinator(repository, {
      fetchImpl: async () =>
        Response.json({
          object: "list",
          data: remoteModels.map((id) => ({
            id,
            object: "model",
            created: 0,
            owned_by: "test",
          })),
        }),
    });

    await coordinator.syncProvider(subject, provider);
    const oneId = "model_provider_catalog_sync_test_one";
    const one = await repository.getModel(oneId);
    if (one === undefined) throw new Error("Expected discovered model");
    await repository.updateModel({ ...one, enabled: false });

    remoteModels = ["two"];
    await coordinator.syncProvider(
      subject,
      (await repository.getProvider(provider.id))!,
    );
    expect(await repository.getModel(oneId)).toMatchObject({
      available: false,
      enabled: false,
    });

    remoteModels = ["one", "two"];
    await coordinator.syncProvider(
      subject,
      (await repository.getProvider(provider.id))!,
    );
    expect(await repository.getModel(oneId)).toMatchObject({
      available: true,
      enabled: false,
    });
    expect(await repository.getProvider(provider.id)).toMatchObject({
      catalogSync: {
        status: "ready",
        modelCount: 2,
      },
    });
  });

  it("keeps the last known catalog available when discovery fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.createProvider({
      id: "provider_catalog_error_test",
      orgId: subject.orgId,
      type: "openai-compatible",
      name: "Catalog error test",
      baseUrl: "https://models.example.test/v1",
      modelIds: ["known-model"],
      enabled: true,
      capabilities: defaultProviderCapabilities("openai-compatible"),
      catalogSync: { status: "never", modelCount: 0 },
    });
    const first = new ProviderCatalogSyncCoordinator(repository);
    await first.syncProvider(subject, provider);

    const failed = new ProviderCatalogSyncCoordinator(repository, {
      fetchImpl: async () => {
        throw new Error("provider offline");
      },
    });
    const configured = await repository.getProvider(provider.id);
    if (configured === undefined) throw new Error("Expected provider");
    await repository.updateProvider({
      ...configured,
      modelIds: [],
      catalogSync: {
        ...configured.catalogSync!,
        status: "stale",
      },
    });

    await expect(
      failed.syncProvider(
        subject,
        (await repository.getProvider(provider.id))!,
      ),
    ).rejects.toMatchObject({ code: "provider_model_discovery_failed" });
    expect(
      await repository.getModel(
        "model_provider_catalog_error_test_known_model",
      ),
    ).toMatchObject({ available: true, enabled: true });
    expect(await repository.getProvider(provider.id)).toMatchObject({
      catalogSync: {
        status: "error",
        modelCount: 1,
      },
    });
  });

  it("preserves a referenced model id when discovery matches its provider name", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.getProvider("provider_openai_compatible");
    if (provider === undefined) throw new Error("Expected seeded provider");

    await repository.updateProvider({
      ...provider,
      modelIds: ["gpt-compatible"],
    });
    const coordinator = new ProviderCatalogSyncCoordinator(repository);
    const models = await coordinator.syncProvider(
      subject,
      (await repository.getProvider(provider.id))!,
    );

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "model_openai_compatible_default",
      name: "gpt-compatible",
      available: true,
    });
    expect(
      await repository.getModel(
        "model_provider_openai_compatible_gpt-compatible",
      ),
    ).toBeUndefined();
  });
});
