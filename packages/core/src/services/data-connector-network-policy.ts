import { lookup } from "node:dns/promises";

import { ApiError } from "../errors";
import {
  isBlockedNetworkAddress,
  isNetworkIpAddress,
  isPrivateNetworkHost,
  networkAddressFamily,
  normalizeNetworkHost,
} from "./network-host-policy";

export type WebsiteConnectorEgressPolicy = "allow_public" | "require_allowlist";
export interface WebsiteConnectorHostAddress {
  address: string;
  family: 4 | 6;
}
export type WebsiteConnectorHostLookup = (
  hostname: string,
) => Promise<WebsiteConnectorHostAddress[]>;

/**
 * The single DNS resolver behind every egress policy check. Records of an
 * unrecognized family are dropped rather than coerced, so an address can never
 * be pinned under the wrong family and reach a socket the policy did not
 * approve.
 */
export const lookupNetworkHost: WebsiteConnectorHostLookup = async (
  hostname,
) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
};

export async function assertConnectorHostAllowed(
  url: URL,
  options: {
    allowedHosts?: string[];
    egressPolicy?: WebsiteConnectorEgressPolicy;
    hostLookup?: WebsiteConnectorHostLookup;
  } = {},
): Promise<WebsiteConnectorHostAddress[]> {
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  const egressPolicy = options.egressPolicy ?? "allow_public";
  const host = normalizeHost(url.hostname);
  if (isPrivateNetworkHost(host))
    throw new ApiError(
      "connector_private_network_host_blocked",
      "Connector host resolves to a private or local network.",
      403,
      { host },
    );
  if (allowedHosts.length === 0) {
    if (egressPolicy === "require_allowlist")
      throw new ApiError(
        "connector_egress_allowlist_required",
        "Connector egress policy requires a host allowlist.",
        403,
      );
  } else if (!allowedHosts.some((rule) => hostMatchesRule(host, rule))) {
    throw new ApiError(
      "connector_egress_host_blocked",
      "Connector host is not in the configured egress allowlist.",
      403,
      { host },
    );
  }
  if (options.hostLookup === undefined || isNetworkIpAddress(host)) return [];
  let addresses: WebsiteConnectorHostAddress[];
  try {
    addresses = await options.hostLookup(host);
  } catch {
    throw new ApiError(
      "connector_dns_lookup_failed",
      "Connector host DNS lookup failed.",
      502,
    );
  }
  if (addresses.length === 0)
    throw new ApiError(
      "connector_dns_lookup_failed",
      "Connector host DNS lookup failed.",
      502,
    );
  if (
    addresses.some(
      (address) => networkAddressFamily(address.address) !== address.family,
    )
  )
    throw new ApiError(
      "connector_dns_lookup_failed",
      "Connector host DNS lookup returned an invalid address.",
      502,
    );
  if (addresses.some((address) => isBlockedNetworkAddress(address.address)))
    throw new ApiError(
      "connector_private_network_host_blocked",
      "Connector host resolves to a private or local network.",
      403,
      { host },
    );
  return addresses;
}

export function normalizeAllowedHosts(hosts: string[] | undefined): string[] {
  return [
    ...new Set(
      (hosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
  ];
}

export function hostMatchesDomainRule(host: string, rule: string): boolean {
  const domain = rule.startsWith("*.") ? rule.slice(2) : rule;
  return host === domain || host.endsWith(`.${domain}`);
}

export function isRedirectResponse(response: Response): boolean {
  return [301, 302, 303, 307, 308].includes(response.status);
}

function hostMatchesRule(host: string, rule: string): boolean {
  if (rule.startsWith("*."))
    return host.endsWith(rule.slice(1)) && host !== rule.slice(2);
  return host === rule;
}

export function normalizeHost(host: string): string {
  return normalizeNetworkHost(host);
}
