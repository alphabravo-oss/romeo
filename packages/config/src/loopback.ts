/**
 * True only for hostnames that always resolve to the local machine. Used to
 * confine the development seeded login to loopback-only deployments.
 * `*.localhost` subdomains and private network addresses are intentionally
 * excluded.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/u, "");
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u.test(normalized)
  );
}

/** True when `value` parses as a URL whose host is loopback. */
export function isLoopbackOrigin(value: string): boolean {
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}
