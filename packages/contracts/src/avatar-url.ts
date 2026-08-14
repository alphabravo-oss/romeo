export const AVATAR_URL_MAX = 32_000;

export interface AvatarImageSource {
  kind: "inline" | "remote";
  src: string;
}

const inlineAvatarPattern =
  /^data:image\/(?:gif|jpeg|png|webp);base64,([a-z\d+/]+={0,2})$/iu;

/**
 * Return the only avatar sources the UI is allowed to fetch or render.
 *
 * DNS names cannot be resolved safely in a browser without making a request,
 * so this blocks literal non-public addresses and localhost names. Deployments
 * that need stronger egress control must still enforce it at the network edge.
 */
export function resolveAvatarImageSource(
  value: null | string | undefined,
): AvatarImageSource | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.length > AVATAR_URL_MAX) return undefined;

  const inlineMatch = inlineAvatarPattern.exec(candidate);
  if (inlineMatch?.[1] && inlineMatch[1].length % 4 === 0) {
    return { kind: "inline", src: candidate };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    isBlockedAvatarHostname(url.hostname)
  ) {
    return undefined;
  }
  return { kind: "remote", src: url.href };
}

export function isAllowedAvatarUrl(value: string): boolean {
  return (
    value.trim().length === 0 || resolveAvatarImageSource(value) !== undefined
  );
}

export function isBlockedAvatarHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== undefined) return isBlockedIpv4(ipv4);

  const ipv6 = parseIpv6(normalized);
  if (ipv6 === undefined) return false;
  const [first = 0] = ipv6;
  if (
    (first & 0xfe00) === 0xfc00 || // unique-local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (first & 0xff00) === 0xff00 // multicast ff00::/8
  ) {
    return true;
  }

  const firstSixAreZero = ipv6.slice(0, 6).every((part) => part === 0);
  const loopback = firstSixAreZero && ipv6[6] === 0 && ipv6[7] === 1;
  const unspecified = ipv6.every((part) => part === 0);
  if (loopback || unspecified) return true;

  const mappedIpv4 =
    ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff;
  if (mappedIpv4 || firstSixAreZero) {
    return isBlockedIpv4([
      (ipv6[6]! >> 8) & 0xff,
      ipv6[6]! & 0xff,
      (ipv6[7]! >> 8) & 0xff,
      ipv6[7]! & 0xff,
    ]);
  }
  return false;
}

function parseIpv4(
  value: string,
): [number, number, number, number] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (
    octets.some(
      (part, index) =>
        !/^\d{1,3}$/u.test(parts[index] ?? "") ||
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255,
    )
  ) {
    return undefined;
  }
  return octets as [number, number, number, number];
}

function isBlockedIpv4([first, second]: [
  number,
  number,
  number,
  number,
]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function parseIpv6(value: string): number[] | undefined {
  if (!value.includes(":")) return undefined;
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const left = parseIpv6Side(halves[0] ?? "");
  const right = parseIpv6Side(halves[1] ?? "");
  if (left === undefined || right === undefined) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function parseIpv6Side(value: string): number[] | undefined {
  if (value.length === 0) return [];
  const parts = value.split(":");
  const result: number[] = [];
  for (const part of parts) {
    if (!/^[\da-f]{1,4}$/iu.test(part)) return undefined;
    result.push(Number.parseInt(part, 16));
  }
  return result;
}
