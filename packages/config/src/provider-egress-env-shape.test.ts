import { describe, expect, it } from "vitest";

import { parseProviderPrivateNetworkAllowedHosts, readEnv } from "./index";

describe("PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS", () => {
  it("defaults to no private provider destinations", () => {
    expect(readEnv({}).PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS).toBe("");
    expect(parseProviderPrivateNetworkAllowedHosts("")).toEqual([]);
  });

  it("parses hosts, ports, wildcards, IPv6 literals, and CIDRs", () => {
    const value =
      "ollama:11434,host.docker.internal:11434,*.models.svc.cluster.local,10.20.0.5,192.168.1.0/24,[fd12::5]:8000,fd00:1234::/32";
    expect(
      readEnv({ PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: value })
        .PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS,
    ).toBe(value);
    expect(parseProviderPrivateNetworkAllowedHosts(value)).toEqual([
      { host: "ollama", kind: "host", port: 11434 },
      { host: "host.docker.internal", kind: "host", port: 11434 },
      { host: "*.models.svc.cluster.local", kind: "host" },
      { host: "10.20.0.5", kind: "host" },
      { cidr: "192.168.1.0/24", kind: "cidr" },
      { host: "fd12::5", kind: "host", port: 8000 },
      { cidr: "fd00:1234::/32", kind: "cidr" },
    ]);
  });

  it("rejects malformed, duplicate, or non-normalized entries", () => {
    for (const value of [
      "Ollama:11434",
      "ollama, vllm",
      "ollama:0",
      "ollama:70000",
      "ollama,ollama",
      "10.0.0.0/33",
      "http://ollama:11434",
      "[not-ipv6]:80",
      ",",
    ]) {
      expect(parseProviderPrivateNetworkAllowedHosts(value)).toBeUndefined();
      expect(() =>
        readEnv({ PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: value }),
      ).toThrow(/PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS/u);
    }
  });
});
