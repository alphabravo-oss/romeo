import { describe, expect, it } from "vitest";

import { toBaseModelRecord, toProviderRecord } from "./provider-repository";

const capabilities = {
  streaming: true,
  toolCalling: true,
  vision: false,
  audioInput: false,
  structuredJson: true,
  reasoning: false,
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
      capabilities,
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
      contextWindow: 128000,
      pricing: { inputTokenUsd: 0.000001, outputTokenUsd: 0.000002 },
      enabled: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });
    const unpriced = toBaseModelRecord({
      id: "model_2",
      orgId: "org_1",
      providerId: "provider_1",
      name: "model-two",
      displayName: "Model Two",
      capabilities: {},
      contextWindow: 8192,
      pricing: { inputTokenUsd: Number.NaN, outputTokenUsd: 1 },
      enabled: false,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(priced.pricing).toEqual({
      inputTokenUsd: 0.000001,
      outputTokenUsd: 0.000002,
    });
    expect(unpriced.pricing).toBeUndefined();
    expect(unpriced.capabilities).toMatchObject({
      streaming: false,
      deployment: { credentialRequired: true },
    });
  });
});
