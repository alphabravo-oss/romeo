import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it, vi } from "vitest";

import { compatibilityProviderFetch } from "./compatibility-provider-egress";

describe("compatibility provider credential egress", () => {
  it("blocks credential-bearing private destinations before raw transport", async () => {
    const rawFetch = vi.fn<typeof fetch>();
    const guarded = compatibilityProviderFetch({
      credentialPresent: true,
      fetchImpl: rawFetch,
      provider: {
        id: "provider_private",
        orgId: "org_default",
        type: "openai-compatible",
        name: "Private target",
        baseUrl: "https://127.0.0.1/v1",
        enabled: true,
        capabilities: defaultProviderCapabilities("openai-compatible"),
      },
      timeoutMs: 1_000,
    });

    await expect(
      guarded?.("https://127.0.0.1/v1/chat/completions"),
    ).rejects.toMatchObject({
      code: "secret_egress_private_network_blocked",
    });
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("keeps credential-free local provider transport explicit", () => {
    const rawFetch = vi.fn<typeof fetch>();
    expect(
      compatibilityProviderFetch({
        credentialPresent: false,
        fetchImpl: rawFetch,
        provider: {
          id: "provider_local",
          orgId: "org_default",
          type: "ollama",
          name: "Local Ollama",
          baseUrl: "http://localhost:11434",
          enabled: true,
          capabilities: defaultProviderCapabilities("ollama"),
        },
        timeoutMs: 1_000,
      }),
    ).toBe(rawFetch);
  });
});
