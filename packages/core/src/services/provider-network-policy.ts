import {
  parseProviderPrivateNetworkAllowedHosts,
  type ProviderPrivateNetworkRule,
  type RomeoEnv,
} from "@romeo/config";

import {
  isAddressInNetworkCidrs,
  isBlockedNetworkAddress,
  isNetworkIpAddress,
  isPrivateNetworkHost,
  normalizeNetworkHost,
} from "./network-host-policy";
import { hostMatchesDomainRule } from "./outbound-network-policy";

/**
 * Model-provider egress policy. Provider base URLs are tenant-admin input, so
 * every provider request must reach a public address unless the operator has
 * named the private destination. Local development (any ROMEO_ENV other than
 * production) may additionally reach loopback so `pnpm dev` + a local Ollama
 * works without configuration.
 */
export interface ProviderNetworkPolicy {
  readonly allowLoopback: boolean;
  readonly privateNetworkRules: readonly ProviderPrivateNetworkRule[];
}

/** Cloud metadata and other never-legitimate model destinations. */
const alwaysBlockedProviderCidrs = [
  "0.0.0.0/8",
  "169.254.0.0/16",
  "100.100.100.200/32",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/128",
  "fe80::/10",
  "fd00:ec2::254/128",
  "ff00::/8",
  "::ffff:0.0.0.0/104",
  "::ffff:169.254.0.0/112",
  "::ffff:100.100.100.200/128",
  "::169.254.0.0/112",
  "64:ff9b::169.254.0.0/112",
] as const;

const alwaysBlockedProviderHostnames = new Set([
  "instance-data",
  "instance-data.ec2.internal",
  "metadata",
  "metadata.goog",
  "metadata.google.internal",
]);

const loopbackCidrs = ["127.0.0.0/8", "::1/128", "::ffff:127.0.0.0/104"];

export class ProviderEgressBlockedError extends Error {
  readonly code = "provider_egress_blocked";

  constructor(readonly reason: ProviderEgressBlockReason) {
    super("Model provider destination is blocked by the egress policy.");
    this.name = "ProviderEgressBlockedError";
  }
}

export type ProviderEgressBlockReason =
  | "metadata_destination"
  | "private_network_not_allowlisted"
  | "dns_lookup_failed"
  | "url_invalid";

export function providerNetworkPolicyFromEnv(
  env: Pick<RomeoEnv, "PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS" | "ROMEO_ENV">,
): ProviderNetworkPolicy {
  return {
    allowLoopback: env.ROMEO_ENV !== "production",
    privateNetworkRules:
      parseProviderPrivateNetworkAllowedHosts(
        env.PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS,
      ) ?? [],
  };
}

export interface ProviderDestination {
  readonly host: string;
  /** The URL host[:port] matched an operator rule, so private answers are allowed. */
  readonly hostAllowlisted: boolean;
  /** Development loopback allowance applies to this hostname. */
  readonly loopbackAllowed: boolean;
}

/**
 * Hostname-level decision, made before any DNS lookup. Throws when the URL can
 * never be a provider destination; otherwise returns what later address checks
 * may accept.
 */
export function evaluateProviderDestination(
  policy: ProviderNetworkPolicy,
  url: URL,
): ProviderDestination {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  )
    throw new ProviderEgressBlockedError("url_invalid");
  const host = normalizeNetworkHost(url.hostname);
  if (
    host.length === 0 ||
    alwaysBlockedProviderHostnames.has(host) ||
    (isNetworkIpAddress(host) && isAlwaysBlockedProviderAddress(host))
  )
    throw new ProviderEgressBlockedError("metadata_destination");
  const port = effectivePort(url);
  const hostAllowlisted = policy.privateNetworkRules.some(
    (rule) =>
      rule.kind === "host" &&
      hostMatchesDomainRuleExact(host, rule.host) &&
      (rule.port === undefined || rule.port === port),
  );
  const loopbackAllowed = policy.allowLoopback && isLoopbackHost(host);
  if (
    !hostAllowlisted &&
    !loopbackAllowed &&
    isPrivateNetworkHost(host) &&
    !(isNetworkIpAddress(host) && addressInAllowedCidr(policy, host))
  )
    throw new ProviderEgressBlockedError("private_network_not_allowlisted");
  return { host, hostAllowlisted, loopbackAllowed };
}

/** Address-level decision for every DNS answer (or the literal IP host). */
export function assertProviderAddressesAllowed(
  policy: ProviderNetworkPolicy,
  destination: ProviderDestination,
  addresses: readonly string[],
): void {
  if (addresses.length === 0)
    throw new ProviderEgressBlockedError("dns_lookup_failed");
  for (const address of addresses) {
    if (isAlwaysBlockedProviderAddress(address))
      throw new ProviderEgressBlockedError("metadata_destination");
    if (!isBlockedNetworkAddress(address)) continue;
    if (destination.hostAllowlisted) continue;
    if (addressInAllowedCidr(policy, address)) continue;
    if (destination.loopbackAllowed && isLoopbackAddress(address)) continue;
    throw new ProviderEgressBlockedError("private_network_not_allowlisted");
  }
}

/**
 * Configuration-time check for a provider base URL. It cannot see DNS, so it
 * only rejects destinations that are blocked by name or literal address; the
 * request-time transport enforces the full policy on every connection.
 */
export function providerBaseUrlPermitted(
  policy: ProviderNetworkPolicy,
  baseUrl: URL,
): boolean {
  try {
    const destination = evaluateProviderDestination(policy, baseUrl);
    if (isNetworkIpAddress(destination.host))
      assertProviderAddressesAllowed(policy, destination, [destination.host]);
    return true;
  } catch (error) {
    if (error instanceof ProviderEgressBlockedError) return false;
    throw error;
  }
}

export function isAlwaysBlockedProviderAddress(address: string): boolean {
  return isAddressInNetworkCidrs(address, alwaysBlockedProviderCidrs);
}

function addressInAllowedCidr(
  policy: ProviderNetworkPolicy,
  address: string,
): boolean {
  const cidrs = policy.privateNetworkRules.flatMap((rule) =>
    rule.kind === "cidr" ? [rule.cidr] : [],
  );
  return cidrs.length > 0 && isAddressInNetworkCidrs(address, cidrs);
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isNetworkIpAddress(host) && isLoopbackAddress(host);
}

function isLoopbackAddress(address: string): boolean {
  return isAddressInNetworkCidrs(address, loopbackCidrs);
}

function hostMatchesDomainRuleExact(host: string, rule: string): boolean {
  // `*.example.com` matches subdomains only; a bare rule matches exactly.
  if (rule.startsWith("*."))
    return host !== rule.slice(2) && hostMatchesDomainRule(host, rule);
  return host === normalizeNetworkHost(rule);
}

function effectivePort(url: URL): number {
  if (url.port.length > 0) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}
