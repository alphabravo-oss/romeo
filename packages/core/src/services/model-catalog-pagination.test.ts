import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ProviderService } from "./provider-service";

const subject: AuthSubject = {
  id: "user_model_catalog",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["models:read"],
};

describe("model catalog pagination", () => {
  it("applies tenant and catalog filters before totals and limits", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.createProvider({
      id: "provider_model_catalog",
      orgId: subject.orgId,
      type: "anthropic",
      name: "Catalog provider",
      baseUrl: "https://api.anthropic.com/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("anthropic"),
    });
    await repository.createProvider({
      id: "provider_other_org",
      orgId: "org_other",
      type: "anthropic",
      name: "Other tenant",
      baseUrl: "https://api.anthropic.com/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("anthropic"),
    });
    await repository.upsertModels([
      model("model_catalog_alpha", provider.id, "Alpha", true),
      {
        ...model("model_catalog_beta", provider.id, "Beta", false),
        available: false,
      },
      model("model_catalog_hidden", "provider_other_org", "Alpha hidden", true),
    ]);
    await repository.createResourceGrant({
      id: "grant_catalog_provider",
      resourceType: "provider",
      resourceId: provider.id,
      principalType: "user",
      principalId: subject.id,
      permission: "use",
    });
    for (const modelId of ["model_catalog_alpha", "model_catalog_beta"]) {
      await repository.createResourceGrant({
        id: `grant_catalog_${modelId}`,
        resourceType: "model",
        resourceId: modelId,
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      });
    }
    const service = new ProviderService(repository);

    const first = await service.modelsPage(subject, {
      limit: 1,
      offset: 0,
      providerId: provider.id,
      query: "a",
    });
    const second = await service.modelsPage(subject, {
      limit: 1,
      offset: 1,
      providerId: provider.id,
      query: "a",
    });
    const disabled = await service.modelsPage(subject, {
      enabled: false,
      limit: 10,
      offset: 0,
      providerId: provider.id,
    });
    const unavailable = await service.modelsPage(subject, {
      available: false,
      limit: 10,
      offset: 0,
      providerId: provider.id,
    });

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)),
    ).toEqual(new Set(["model_catalog_alpha", "model_catalog_beta"]));
    expect(disabled.items.map((item) => item.id)).toEqual([
      "model_catalog_beta",
    ]);
    expect(unavailable.items.map((item) => item.id)).toEqual([
      "model_catalog_beta",
    ]);
  });
});

function model(
  id: string,
  providerId: string,
  displayName: string,
  enabled: boolean,
) {
  return {
    id,
    providerId,
    name: displayName.toLocaleLowerCase(),
    displayName,
    enabled,
    capabilities: defaultProviderCapabilities("anthropic"),
    contextWindow: 200_000,
  };
}
