import { describe, expect, it } from "vitest";

import {
  ProviderKindCatalogEntrySchema,
  ProviderKindConfigurationFieldSchema,
} from "./provider-kind-catalog";

const entry = {
  kind: "ollama",
  defaultClassification: "local",
  supportedClassifications: ["local"],
  displayName: "Ollama",
  dialect: {
    contractVersion: "1",
    version: "ollama-native.v1",
    operations: {
      audio: false,
      batches: false,
      capabilityProbing: false,
      chat: true,
      discovery: true,
      embeddings: true,
      errorNormalization: true,
      files: false,
      imageGeneration: false,
      tokenCounting: false,
      usageParsing: true,
    },
  },
  defaultCapabilities: {
    streaming: true,
    toolCalling: true,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    temperature: true,
    imageGeneration: false,
    modalities: ["text"],
    deployment: {
      mode: "local-runtime",
      networkAccess: "local-http",
      credentialRequired: false,
    },
  },
  configuration: {
    schemaVersion: 1,
    fields: [
      {
        id: "name",
        input: "text",
        required: true,
        writeOnly: false,
        sensitive: false,
        maxLength: 200,
        copyKey: "providerSetupFieldName",
      },
      {
        id: "baseUrl",
        input: "url",
        required: true,
        writeOnly: false,
        sensitive: false,
        maxLength: 2_000,
        copyKey: "providerSetupFieldBaseUrl",
      },
      {
        id: "credentialRef",
        input: "secret_reference",
        required: false,
        writeOnly: true,
        sensitive: true,
        maxLength: 500,
        copyKey: "providerSetupFieldCredentialRef",
      },
    ],
  },
} as const;

describe("provider kind catalog contracts", () => {
  it("accepts bounded, secret-free setup metadata", () => {
    expect(ProviderKindCatalogEntrySchema.parse(entry)).toEqual(entry);
    expect(JSON.stringify(entry)).not.toMatch(
      /(?:api[_-]?key|authorization|credentialValue|password|secretValue)/iu,
    );
  });

  it("rejects arbitrary UI field identifiers and server-supplied values", () => {
    expect(
      ProviderKindConfigurationFieldSchema.safeParse({
        ...entry.configuration.fields[0],
        id: "customHtml",
      }).success,
    ).toBe(false);
    expect(
      ProviderKindConfigurationFieldSchema.safeParse({
        ...entry.configuration.fields[2],
        value: "vault://tenant/secret",
      }).success,
    ).toBe(false);
  });

  it("keeps the catalog entry strict", () => {
    expect(
      ProviderKindCatalogEntrySchema.safeParse({
        ...entry,
        configuredProviders: [{ baseUrl: "https://private.example" }],
      }).success,
    ).toBe(false);
  });
});
