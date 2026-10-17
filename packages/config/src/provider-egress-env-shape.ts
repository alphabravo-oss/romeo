import { isIP } from "node:net";

import { z } from "zod";

/**
 * One operator-approved private model-provider destination. A `host` rule
 * matches the provider base URL hostname (exactly, or any subdomain for a
 * `*.` rule) and, when a port is given, the effective URL port. A `cidr` rule
 * matches the addresses the provider hostname resolves to.
 */
export type ProviderPrivateNetworkRule =
  | { kind: "cidr"; cidr: string }
  | { host: string; kind: "host"; port?: number };

const dnsHostPattern =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/u;

/**
 * Parses PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS. Entries are comma-separated,
 * lowercase and unique: `host`, `host:port`, `*.domain`, `*.domain:port`,
 * an IPv4 literal (optionally with `:port`), a bracketed IPv6 literal
 * (optionally with `:port`), or an IPv4/IPv6 CIDR. Returns undefined when any
 * entry is malformed so callers fail closed instead of silently dropping it.
 */
export function parseProviderPrivateNetworkAllowedHosts(
  value: string,
): ProviderPrivateNetworkRule[] | undefined {
  if (value.length === 0) return [];
  const entries = value.split(",");
  if (new Set(entries).size !== entries.length) return undefined;
  const rules: ProviderPrivateNetworkRule[] = [];
  for (const entry of entries) {
    const rule = parseRule(entry);
    if (rule === undefined) return undefined;
    rules.push(rule);
  }
  return rules;
}

function parseRule(entry: string): ProviderPrivateNetworkRule | undefined {
  if (entry.length === 0 || entry !== entry.trim().toLowerCase())
    return undefined;
  if (entry.includes("/")) return parseCidr(entry);
  if (entry.startsWith("[")) {
    const match = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/u.exec(entry);
    if (match === null || isIP(match[1]!) !== 6) return undefined;
    return withPort({ host: match[1]!, kind: "host" }, match[2]);
  }
  if (isIP(entry) === 6) return { host: entry, kind: "host" };
  const separator = entry.lastIndexOf(":");
  const host = separator === -1 ? entry : entry.slice(0, separator);
  const port = separator === -1 ? undefined : entry.slice(separator + 1);
  if (isIP(host) !== 4 && !dnsHostPattern.test(host)) return undefined;
  if (port !== undefined && !/^\d{1,5}$/u.test(port)) return undefined;
  return withPort({ host, kind: "host" }, port);
}

function withPort(
  rule: { host: string; kind: "host" },
  port: string | undefined,
): ProviderPrivateNetworkRule | undefined {
  if (port === undefined) return rule;
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) return undefined;
  return { ...rule, port: value };
}

function parseCidr(entry: string): ProviderPrivateNetworkRule | undefined {
  const [network, prefix, ...rest] = entry.split("/");
  if (network === undefined || prefix === undefined || rest.length > 0)
    return undefined;
  const family = isIP(network);
  if (family === 0 || !/^\d{1,3}$/u.test(prefix)) return undefined;
  const bits = Number(prefix);
  if (bits > (family === 4 ? 32 : 128)) return undefined;
  return { cidr: entry, kind: "cidr" };
}

export const providerEgressEnvShape = {
  PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: z
    .string()
    .default("")
    .superRefine((value, context) => {
      if (parseProviderPrivateNetworkAllowedHosts(value) !== undefined) return;
      context.addIssue({
        code: "custom",
        message:
          "PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS must contain unique, lowercase comma-separated host, host:port, *.domain, [ipv6]:port, or CIDR entries without whitespace.",
      });
    }),
} as const;
