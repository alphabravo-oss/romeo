export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.")
  ) {
    return true;
  }
  const match = /^172\.(\d{1,2})\./u.exec(host);
  return (
    match?.[1] !== undefined && Number(match[1]) >= 16 && Number(match[1]) <= 31
  );
}
