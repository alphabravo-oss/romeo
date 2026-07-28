import { ApiError } from "../errors";

export type WebsiteConnectorEgressPolicy = "allow_public" | "require_allowlist";
export interface WebsiteConnectorHostAddress {
  address: string;
  family: 4 | 6;
}
export type WebsiteConnectorHostLookup = (
  hostname: string,
) => Promise<WebsiteConnectorHostAddress[]>;

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
  if (isBlockedConnectorHost(host))
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
  if (options.hostLookup === undefined || isIpAddress(host)) return [];
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
  if (addresses.some((address) => isBlockedIpAddress(address.address)))
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
  return host.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

function isBlockedConnectorHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  return isBlockedIpAddress(host);
}

function isIpAddress(value: string): boolean {
  return isIPv4(value) || value.includes(":");
}

function isBlockedIpAddress(value: string): boolean {
  if (isIPv4(value)) return isBlockedIPv4(value);
  if (value.includes(":")) return isBlockedIPv6(value);
  return false;
}

function isIPv4(value: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) &&
    value.split(".").every((part) => {
      const parsed = Number(part);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
    })
  );
}

function isBlockedIPv4(value: string): boolean {
  const [first = 0, second = 0] = value.split(".").map(Number);
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && (second === 0 || second === 168)) return true;
  if (first === 198 && (second === 18 || second === 19 || second === 51))
    return true;
  return first === 203 && second === 0;
}

function isBlockedIPv6(value: string): boolean {
  const groups = expandIPv6(value);
  if (groups === undefined) return true;
  const [first = 0, second = 0] = groups;
  const allZeroPrefix = groups.slice(0, 6).every((group) => group === 0);
  const embeddedIpv4 = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)
    return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00 || (first === 0x100 && second === 0))
    return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if (
    allZeroPrefix ||
    (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
  )
    return isBlockedIPv4(embeddedIpv4);
  if (
    first === 0x0064 &&
    second === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  )
    return isBlockedIPv4(embeddedIpv4);
  return false;
}

function expandIPv6(value: string): number[] | undefined {
  const normalized = value.toLowerCase().split("%")[0];
  if (normalized === undefined || normalized.length === 0) return undefined;
  const separator = normalized.indexOf("::");
  if (separator !== -1 && normalized.indexOf("::", separator + 1) !== -1)
    return undefined;
  const [leftValue, rightValue = ""] =
    separator === -1
      ? [normalized, ""]
      : [normalized.slice(0, separator), normalized.slice(separator + 2)];
  const left = ipv6Pieces(leftValue);
  const right = ipv6Pieces(rightValue);
  if (left === undefined || right === undefined) return undefined;
  const missing = 8 - left.length - right.length;
  if ((separator === -1 && missing !== 0) || (separator !== -1 && missing < 1))
    return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function ipv6Pieces(value: string): number[] | undefined {
  if (value.length === 0) return [];
  const pieces = value.split(":");
  const output: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1 || !isIPv4(piece)) return undefined;
      const octets = piece.split(".").map(Number);
      output.push(
        (octets[0]! << 8) | octets[1]!,
        (octets[2]! << 8) | octets[3]!,
      );
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/u.test(piece)) return undefined;
    output.push(Number.parseInt(piece, 16));
  }
  return output;
}
