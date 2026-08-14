import { seededSubject } from "@romeo/auth";
import { ProviderKindCatalogEntrySchema } from "@romeo/contracts";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { listProviderKindCatalog } from "./services/provider-kind-catalog";

describe("provider kind catalog", () => {
  it("derives a sorted, defensive, truthful catalog from the dialect registry", () => {
    const first = listProviderKindCatalog(seededSubject);
    expect(first.map(({ kind }) => kind)).toEqual([
      "anthropic",
      "ollama",
      "openai-compatible",
      "openai-responses-compatible",
    ]);
    expect(
      first.map((entry) => ProviderKindCatalogEntrySchema.parse(entry)),
    ).toEqual(first);
    expect(first.find(({ kind }) => kind === "ollama")).toMatchObject({
      defaultClassification: "local",
      supportedClassifications: ["local"],
      defaultCapabilities: {
        deployment: { credentialRequired: false },
      },
      dialect: {
        operations: { chat: true, discovery: true, embeddings: true },
      },
    });
    expect(first.find(({ kind }) => kind === "anthropic")).toMatchObject({
      defaultClassification: "external",
      supportedClassifications: ["external"],
      defaultCapabilities: {
        deployment: { credentialRequired: true },
      },
      dialect: {
        operations: { chat: true, discovery: true, embeddings: false },
      },
    });
    expect(
      first
        .find(({ kind }) => kind === "anthropic")
        ?.configuration.fields.find(({ id }) => id === "credentialRef"),
    ).toMatchObject({ required: true, sensitive: true, writeOnly: true });
    expect(
      first
        .find(({ kind }) => kind === "openai-compatible")
        ?.configuration.fields.find(({ id }) => id === "credentialRef"),
    ).toMatchObject({ required: false, sensitive: true, writeOnly: true });

    first[0]!.configuration.fields.length = 0;
    expect(
      listProviderKindCatalog(seededSubject)[0]!.configuration.fields,
    ).toHaveLength(4);
  });

  it("requires provider-read scope without exposing configured tenant data", async () => {
    const {
      adminRole: _adminRole,
      isAdmin: _isAdmin,
      ...nonAdminSubject
    } = seededSubject;
    expect(() =>
      listProviderKindCatalog({
        ...nonAdminSubject,
        scopes: nonAdminSubject.scopes.filter(
          (scope) => scope !== "providers:read",
        ),
      }),
    ).toThrow("Missing required scope: providers:read");

    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      startBackgroundWorkers: false,
    });
    const response = await api.request("/api/v1/provider-kinds");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(4);
    expect(JSON.stringify(body)).not.toMatch(
      /(?:credentialValue|password|secretValue|vault:\/\/)/iu,
    );
  });
});
