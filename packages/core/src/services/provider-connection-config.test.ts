import { describe, expect, it } from "vitest";

import { validateProviderConnectionConfig } from "./provider-connection-config";

describe("validateProviderConnectionConfig", () => {
  it("accepts a dialect-valid write-only secret ref and never treats raw keys as configured", () => {
    const accepted = validateProviderConnectionConfig({
      auth: "api_key",
      baseUrl: "https://api.anthropic.com",
      credentialRef: "romeo-secret://org/anthropic-key",
      kind: "anthropic",
      name: "Anthropic",
      target: "anthropic",
    });
    expect(accepted).toMatchObject({
      outcome: "accepted",
      config: {
        credentialMode: "write_only",
        credentialRef: "romeo-secret://org/anthropic-key",
        target: "anthropic",
      },
    });
    expect(JSON.stringify(accepted)).not.toMatch(/sk-|Bearer /u);
  });

  it("denies raw secrets, missing Anthropic credentials, and residency violations", () => {
    expect(
      validateProviderConnectionConfig({
        baseUrl: "https://api.anthropic.com",
        credentialRef: "sk-live-secret",
        kind: "anthropic",
        name: "Bad",
      }),
    ).toEqual({ code: "provider_raw_secret_forbidden", outcome: "denied" });
    expect(
      validateProviderConnectionConfig({
        baseUrl: "https://api.anthropic.com",
        kind: "anthropic",
        name: "Missing",
      }),
    ).toEqual({ code: "provider_credential_required", outcome: "denied" });
    expect(
      validateProviderConnectionConfig({
        baseUrl: "https://localhost:11434",
        kind: "ollama",
        name: "Local",
        region: "us-east-1",
        tenantResidency: "eu",
      }),
    ).toEqual({
      code: "provider_region_outside_residency",
      outcome: "denied",
    });
  });
});
