import { describe, expect, it } from "vitest";

import type { BaseModel } from "../features/providers/types";
import {
  catalogUnavailableReason,
  modelCatalogSurface,
} from "./catalog-model-surface";

const model = {
  available: true,
  capabilities: {
    audioInput: false,
    deployment: {
      credentialRequired: true,
      mode: "hosted-api",
      networkAccess: "external-http",
    },
    modalities: ["text", "vision"],
    reasoning: false,
    streaming: true,
    structuredJson: true,
    toolCalling: true,
    vision: true,
  },
  capabilitiesSource: "override",
  contextWindow: 128_000,
  defaultParameters: { maxOutputTokens: 4_096 },
  displayName: "Vision",
  enabled: true,
  id: "model_1",
  name: "vision",
  pricing: { inputTokenUsd: 0.001, outputTokenUsd: 0.002 },
  providerId: "provider_1",
} as BaseModel;

describe("modelCatalogSurface", () => {
  it("labels native, emulated, and unsupported capabilities", () => {
    const surface = modelCatalogSurface({
      ...model,
      probedAt: new Date().toISOString(),
    });
    expect(surface).toMatchObject({
      deploymentBoundary: "hosted-api",
      maxOutputTokens: 4_096,
      probeFreshness: "fresh",
      reasoning: "unsupported",
      tools: "emulated",
      vision: "emulated",
    });
  });

  it("names why a catalog model cannot be selected", () => {
    expect(catalogUnavailableReason({ ...model, available: false })).toBe(
      "not_in_latest_sync",
    );
    expect(catalogUnavailableReason({ ...model, enabled: false })).toBe(
      "not_entitled",
    );
  });
});
