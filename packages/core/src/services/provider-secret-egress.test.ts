import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it, vi } from "vitest";

import { governedProviderFetch } from "./provider-secret-egress";

const remoteProvider = {
  id: "provider_remote",
  orgId: "org_default",
  type: "openai-compatible" as const,
  name: "Remote provider",
  baseUrl: "https://provider.example.test/v1",
  enabled: true,
  capabilities: defaultProviderCapabilities("openai-compatible"),
};

describe("native provider secret egress", () => {
  it("routes the configured credential-bearing origin through the guard", async () => {
    const rawFetch = vi.fn(async () => Response.json({ ok: true }));
    const providerFetch = governedProviderFetch({
      fetchImpl: rawFetch,
      providerApiKeys: { provider_remote: "managed-secret" },
      providers: [remoteProvider],
      timeoutMs: 1_000,
    });

    await expect(
      providerFetch("https://provider.example.test/v1/chat/completions", {
        headers: { authorization: "Bearer managed-secret" },
      }).then((response) => response.json()),
    ).resolves.toEqual({ ok: true });
    expect(rawFetch).toHaveBeenCalledOnce();
  });

  it("blocks an adapter from carrying a secret to an unreviewed origin", async () => {
    const rawFetch = vi.fn<typeof fetch>();
    const providerFetch = governedProviderFetch({
      fetchImpl: rawFetch,
      providerApiKeys: { provider_remote: "managed-secret" },
      providers: [remoteProvider],
      timeoutMs: 1_000,
    });

    await expect(
      providerFetch("https://capture.example.test/v1/chat/completions", {
        headers: { "x-api-key": "managed-secret" },
      }),
    ).rejects.toMatchObject({ code: "secret_egress_destination_blocked" });
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("retains explicit credential-free local transport", async () => {
    const rawFetch = vi.fn(async () => Response.json({ ok: true }));
    const providerFetch = governedProviderFetch({
      fetchImpl: rawFetch,
      providerApiKeys: {},
      providers: [
        {
          ...remoteProvider,
          id: "provider_local",
          type: "ollama",
          baseUrl: "http://localhost:11434",
          capabilities: defaultProviderCapabilities("ollama"),
        },
      ],
      timeoutMs: 1_000,
    });
    await expect(
      providerFetch("http://localhost:11434/api/chat").then((response) =>
        response.json(),
      ),
    ).resolves.toEqual({ ok: true });
  });
});
