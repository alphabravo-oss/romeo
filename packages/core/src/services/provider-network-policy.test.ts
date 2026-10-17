import { describe, expect, it } from "vitest";

import { validateProviderConnectionConfig } from "./provider-connection-config";
import {
  assertProviderAddressesAllowed,
  evaluateProviderDestination,
  providerBaseUrlPermitted,
  providerNetworkPolicyFromEnv,
  type ProviderNetworkPolicy,
} from "./provider-network-policy";

function policy(
  allowed = "",
  romeoEnv: "development" | "production" = "production",
): ProviderNetworkPolicy {
  return providerNetworkPolicyFromEnv({
    PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: allowed,
    ROMEO_ENV: romeoEnv,
  });
}

function allowed(
  value: ProviderNetworkPolicy,
  url: string,
  addresses: string[],
): boolean {
  try {
    const destination = evaluateProviderDestination(value, new URL(url));
    assertProviderAddressesAllowed(value, destination, addresses);
    return true;
  } catch {
    return false;
  }
}

describe("provider network policy", () => {
  it("allows public answers and blocks private ones without an allowlist", () => {
    const production = policy();
    expect(
      allowed(production, "https://api.openai.com/v1", ["162.159.140.245"]),
    ).toBe(true);
    expect(allowed(production, "http://10-0-0-5.nip.io/v1", ["10.0.0.5"])).toBe(
      false,
    );
    expect(allowed(production, "http://10.0.0.5:11434", ["10.0.0.5"])).toBe(
      false,
    );
    expect(
      allowed(production, "http://ollama.models.svc.cluster.local:11434", [
        "10.96.0.12",
      ]),
    ).toBe(false);
    expect(allowed(production, "http://localhost:11434", ["127.0.0.1"])).toBe(
      false,
    );
  });

  it("permits loopback outside production so local Ollama works by default", () => {
    const development = policy("", "development");
    expect(
      allowed(development, "http://localhost:11434", ["127.0.0.1", "::1"]),
    ).toBe(true);
    expect(allowed(development, "http://127.0.0.1:11434", ["127.0.0.1"])).toBe(
      true,
    );
    // A loopback name that resolves elsewhere is still refused.
    expect(allowed(development, "http://localhost:11434", ["10.0.0.5"])).toBe(
      false,
    );
    expect(allowed(development, "http://10.0.0.5:11434", ["10.0.0.5"])).toBe(
      false,
    );
  });

  it("permits operator-allowlisted private hosts, ports, wildcards, and CIDRs", () => {
    const configured = policy(
      "ollama.lan:11434,*.models.svc.cluster.local,10.20.0.0/16,[fd12::5]:8000",
    );
    expect(
      allowed(configured, "http://ollama.lan:11434", ["192.168.1.20"]),
    ).toBe(true);
    expect(
      allowed(configured, "http://ollama.lan:8080", ["192.168.1.20"]),
    ).toBe(false);
    expect(
      allowed(configured, "http://vllm.models.svc.cluster.local:8000/v1", [
        "10.96.0.12",
      ]),
    ).toBe(true);
    expect(allowed(configured, "http://gpu-box.corp", ["10.20.4.5"])).toBe(
      true,
    );
    expect(allowed(configured, "http://gpu-box.corp", ["10.21.4.5"])).toBe(
      false,
    );
    expect(allowed(configured, "http://[fd12::5]:8000", ["fd12::5"])).toBe(
      true,
    );
  });

  it("always blocks metadata and link-local destinations, even when allowlisted", () => {
    const configured = policy(
      "169.254.169.254,metadata.google.internal,0.0.0.0/0,::/0,evil.example",
      "development",
    );
    for (const [url, addresses] of [
      ["http://169.254.169.254/latest/meta-data", ["169.254.169.254"]],
      ["http://metadata.google.internal/computeMetadata", ["169.254.169.254"]],
      ["http://evil.example/v1", ["169.254.169.254"]],
      ["http://evil.example/v1", ["::ffff:169.254.169.254"]],
      ["http://[fd00:ec2::254]/latest", ["fd00:ec2::254"]],
      ["http://evil.example/v1", ["fe80::1"]],
      ["http://100.100.100.200/latest", ["100.100.100.200"]],
    ] as const) {
      expect(allowed(configured, url, [...addresses])).toBe(false);
    }
  });

  it("rejects blocked base URLs when a provider is configured", () => {
    const production = policy();
    expect(
      providerBaseUrlPermitted(production, new URL("http://169.254.169.254/")),
    ).toBe(false);
    expect(
      providerBaseUrlPermitted(production, new URL("http://localhost:11434")),
    ).toBe(false);
    expect(
      providerBaseUrlPermitted(
        policy("localhost:11434"),
        new URL("http://localhost:11434"),
      ),
    ).toBe(true);
    // Names are only decided at request time, once DNS is known.
    expect(
      providerBaseUrlPermitted(production, new URL("http://ollama.lan:11434")),
    ).toBe(true);

    expect(
      validateProviderConnectionConfig({
        baseUrl: "http://169.254.169.254/latest",
        kind: "openai-compatible",
        name: "Metadata",
        networkPolicy: production,
      }),
    ).toEqual({ code: "provider_base_url_blocked", outcome: "denied" });
    expect(
      validateProviderConnectionConfig({
        baseUrl: "http://user:pass@ollama.lan:11434",
        kind: "ollama",
        name: "Credentials in URL",
      }),
    ).toEqual({ code: "provider_field_invalid", outcome: "denied" });
  });
});
