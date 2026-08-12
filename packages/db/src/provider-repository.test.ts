import { describe, expect, it } from "vitest";

import { toBaseModelRecord, toProviderRecord } from "./provider-repository";

const capabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: true,
  reasoning: false,
  imageGeneration: false,
  modalities: ["text", "vision", "text"],
  deployment: {
    mode: "hosted-api",
    networkAccess: "external-http",
    credentialRequired: true,
  },
};

describe("provider repository mappers", () => {
  it("maps provider rows with internal credential references", () => {
    const provider = toProviderRecord({
      id: "provider_1",
      orgId: "org_1",
      type: "openai-compatible",
      name: "Provider One",
      baseUrl: "https://api.example.com/v1",
      credentialRef: "vault://providers/provider-1",
      modelIds: null,
      capabilities,
      catalogSync: {
        status: "ready",
        modelCount: 12,
        lastAttemptAt: "2026-06-27T00:00:30.000Z",
        lastSyncedAt: "2026-06-27T00:00:31.000Z",
      },
      enabled: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
    });

    expect(provider).toEqual({
      id: "provider_1",
      orgId: "org_1",
      type: "openai-compatible",
      name: "Provider One",
      baseUrl: "https://api.example.com/v1",
      credentialRef: "vault://providers/provider-1",
      enabled: true,
      catalogSync: {
        status: "ready",
        modelCount: 12,
        lastAttemptAt: "2026-06-27T00:00:30.000Z",
        lastSyncedAt: "2026-06-27T00:00:31.000Z",
      },
      capabilities: {
        ...capabilities,
        modalities: ["text", "vision"],
      },
    });
  });

  it("maps model rows with optional pricing", () => {
    const priced = toBaseModelRecord({
      id: "model_1",
      orgId: "org_1",
      providerId: "provider_1",
      name: "model-one",
      displayName: "Model One",
      capabilities,
      capabilitiesSource: "detected",
      contextWindow: 128000,
      pricing: {
        inputTokenUsd: 0.000001,
        outputTokenUsd: 0.000002,
        imageGenerationUsd: {
          "1024x1024": 0.04,
          "1024x1536": 0.08,
          "1536x1024": 0.08,
        },
      },
      enabled: true,
      available: true,
      defaultParameters: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });
    const unpriced = toBaseModelRecord({
      id: "model_2",
      orgId: "org_1",
      providerId: "provider_1",
      name: "model-two",
      displayName: "Model Two",
      capabilities: {},
      capabilitiesSource: "detected",
      contextWindow: 8192,
      pricing: { inputTokenUsd: Number.NaN, outputTokenUsd: 1 },
      enabled: false,
      available: false,
      defaultParameters: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(priced.pricing).toEqual({
      inputTokenUsd: 0.000001,
      outputTokenUsd: 0.000002,
      imageGenerationUsd: {
        "1024x1024": 0.04,
        "1024x1536": 0.08,
        "1536x1024": 0.08,
      },
    });
    expect(priced.available).toBe(true);
    expect(unpriced.available).toBe(false);
    expect(unpriced.pricing).toBeUndefined();
    expect(unpriced.capabilities).toMatchObject({
      streaming: false,
      deployment: { credentialRequired: true },
    });
  });
});
