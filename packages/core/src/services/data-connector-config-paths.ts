import { ApiError } from "../errors";

export function boundedString(
  value: string,
  maxLength: number,
  key: string,
): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be between 1 and ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

export function normalizeApiPath(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (
    normalized.length > 180 ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    normalized.split("/").includes("..") ||
    !/^\/[A-Za-z0-9._~/-]+$/u.test(normalized)
  ) {
    throw new ApiError(
      "invalid_connector_config",
      "Connector apiPath is invalid.",
      400,
    );
  }
  return normalized;
}

export function normalizePathPrefix(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0) return "";
  if (!isSafeGitHubPathPart(normalized))
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector pathPrefix is invalid.",
      400,
    );
  return normalized;
}

export function isSafeGitHubPathPart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    /^[A-Za-z0-9_./-]+$/u.test(value) &&
    !value.split("/").includes("..")
  );
}

export function normalizeExternalHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(
      "invalid_connector_url",
      "Connector URL is invalid.",
      400,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new ApiError(
      "invalid_connector_url",
      "Connector URL must be HTTPS and cannot include credentials or fragments.",
      400,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (isBlockedHost(host))
    throw new ApiError(
      "private_network_host_blocked",
      "Connector URL cannot target private or local hosts.",
      400,
      { host },
    );
  return parsed.toString();
}

function isBlockedHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  if (host.includes(":")) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return false;
}
