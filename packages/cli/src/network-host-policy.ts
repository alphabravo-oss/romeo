import { isIP } from "node:net";

const blockedHostnameSuffixes = [
  ".cluster.local",
  ".internal",
  ".local",
  ".localhost",
  ".svc",
];

const blockedHostnames = new Set([
  "cluster.local",
  "internal",
  "kubernetes.default",
  "local",
  "localhost",
  "metadata.google.internal",
  "svc",
]);

const blockedIpv4Cidrs: Array<readonly [network: number, prefix: number]> = [
  [ipv4Integer("0.0.0.0"), 8],
  [ipv4Integer("10.0.0.0"), 8],
  [ipv4Integer("100.64.0.0"), 10],
  [ipv4Integer("127.0.0.0"), 8],
  [ipv4Integer("169.254.0.0"), 16],
  [ipv4Integer("172.16.0.0"), 12],
  [ipv4Integer("192.0.0.0"), 24],
  [ipv4Integer("192.0.2.0"), 24],
  [ipv4Integer("192.88.99.0"), 24],
  [ipv4Integer("192.168.0.0"), 16],
  [ipv4Integer("198.18.0.0"), 15],
  [ipv4Integer("198.51.100.0"), 24],
  [ipv4Integer("203.0.113.0"), 24],
  [ipv4Integer("224.0.0.0"), 4],
  [ipv4Integer("240.0.0.0"), 4],
];

export function normalizeNetworkHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/\.+$/u, "");
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const host = normalizeNetworkHost(hostname);
  if (host.length === 0) return true;
  if (
    blockedHostnames.has(host) ||
    blockedHostnameSuffixes.some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }
  return isBlockedNetworkAddress(host);
}

export function isNetworkIpAddress(value: string): boolean {
  return networkAddressFamily(value) !== undefined;
}

export function networkAddressFamily(value: string): 4 | 6 | undefined {
  const family = isIP(normalizeNetworkHost(value));
  return family === 4 || family === 6 ? family : undefined;
}

export function normalizeResolvedNetworkAddress(
  address: string,
  family?: number,
): { address: string; family: 4 | 6 } | undefined {
  const normalized = normalizeNetworkHost(address);
  const detectedFamily = networkAddressFamily(normalized);
  if (
    detectedFamily === undefined ||
    (family !== undefined && family !== detectedFamily)
  ) {
    return undefined;
  }
  return { address: normalized, family: detectedFamily };
}

export function isBlockedNetworkAddress(value: string): boolean {
  const address = normalizeNetworkHost(value).split("%")[0] ?? "";
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return address.includes(":");
}

function isBlockedIpv4(value: string): boolean {
  const address = ipv4Integer(value);
  return blockedIpv4Cidrs.some(([network, prefix]) =>
    ipv4InCidr(address, network, prefix),
  );
}

function ipv4InCidr(address: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0 === (network & mask) >>> 0;
}

function ipv4Integer(value: string): number {
  return value
    .split(".")
    .map(Number)
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}

function isBlockedIpv6(value: string): boolean {
  const groups = expandIpv6(value);
  if (groups === undefined) return true;
  const [first = 0, second = 0] = groups;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)
    return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x0100 && second === 0) return true;
  if (first === 0x2001 && second === 0) return true;
  if (first === 0x2001 && second === 2) return true;
  if (first === 0x2001 && (second & 0xfff0) === 0x0010) return true;
  if (first === 0x2001 && (second & 0xfff0) === 0x0020) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if (first === 0x2002) return true;
  if ((first & 0xfff0) === 0x3ff0) return true;

  const embeddedIpv4 = ipv4FromGroups(groups[6]!, groups[7]!);
  const ipv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const ipv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const nat64WellKnown =
    first === 0x0064 &&
    second === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0);
  const nat64Local =
    first === 0x0064 &&
    second === 0xff9b &&
    groups[2] === 1 &&
    groups.slice(3, 6).every((group) => group === 0);
  if (ipv4Compatible || ipv4Mapped || nat64WellKnown || nat64Local) {
    return isBlockedIpv4(embeddedIpv4);
  }
  return false;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function expandIpv6(value: string): number[] | undefined {
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
      if (index !== pieces.length - 1 || isIP(piece) !== 4) return undefined;
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
