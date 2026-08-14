import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ProviderCapabilityEvidence,
  ProviderModelCapabilityEvidence,
} from "../features/providers/types";
import { LocaleProvider } from "../lib/i18n";
import {
  ProviderCapabilityEvidenceView,
  ProviderModelCapabilityEvidenceView,
} from "./ProviderCapabilityEvidence";

const capabilities: ProviderCapabilityEvidence["configuredCapabilities"] = {
  streaming: true,
  toolCalling: true,
  vision: true,
  audioInput: false,
  structuredJson: true,
  reasoning: true,
  imageGeneration: false,
  modalities: ["text", "vision"],
  deployment: {
    mode: "hosted-api",
    networkAccess: "external-http",
    credentialRequired: true,
  },
};

const dialect = {
  contractVersion: "1",
  version: "openai-compatible.v1",
  operations: {
    audio: false,
    batches: false,
    capabilityProbing: false,
    chat: true,
    discovery: true,
    embeddings: true,
    errorNormalization: true,
    files: false,
    imageGeneration: true,
    tokenCounting: false,
    usageParsing: true,
  },
} as const;

describe("provider capability evidence", () => {
  it("labels configured evidence without exposing provider connection details", () => {
    const report: ProviderCapabilityEvidence = {
      providerId: "provider_safe",
      kind: "openai-compatible",
      enabled: true,
      credentialConfigured: true,
      dialect,
      advertisedDefaults: capabilities,
      configuredCapabilities: { ...capabilities, reasoning: false },
      catalog: { status: "ready", modelCount: 2 },
      visibleModels: { total: 2, enabled: 1, available: 2 },
    };
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <ProviderCapabilityEvidenceView report={report} />
      </LocaleProvider>,
    );

    expect(markup).toContain("providerCapabilityOverridesDefaults");
    expect(markup).toContain("2 / 1 / 2");
    expect(markup).not.toMatch(/baseUrl|credentialRef|api[_-]?key|secret/iu);
  });

  it("distinguishes provider-disabled operation from policy authorization", () => {
    const report: ProviderModelCapabilityEvidence = {
      modelId: "model_safe",
      providerId: "provider_safe",
      kind: "openai-compatible",
      name: "model-safe",
      displayName: "Model safe",
      enabled: true,
      available: true,
      capabilitySource: "detected",
      capabilities,
      limits: { contextWindow: 128_000 },
      provider: { enabled: false, dialect, catalogStatus: "ready" },
      operationallyUsable: false,
      operationalReason: "provider_disabled",
    };
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <ProviderModelCapabilityEvidenceView report={report} />
      </LocaleProvider>,
    );

    expect(markup).toContain("modelOperationalProviderDisabled");
    expect(markup).toContain("providerCapabilityNotAuthorization");
    expect(markup).toContain("128,000");
  });
});
