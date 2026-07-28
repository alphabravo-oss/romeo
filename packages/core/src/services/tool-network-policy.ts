import type { ToolNetworkPolicy } from "../domain/entities";
import { ApiError } from "../errors";
import { isPrivateNetworkHost } from "./network-host-policy";

const hostnamePattern = /^[a-z0-9.-]+$/i;

export function normalizeToolNetworkPolicy(
  input: ToolNetworkPolicy,
): ToolNetworkPolicy {
  if (input.mode === "deny_all")
    return { mode: "deny_all", allowedHosts: [], allowPrivateNetwork: false };
  const allowedHosts = [
    ...new Set(input.allowedHosts.map(normalizeHost)),
  ].sort();
  if (allowedHosts.length === 0)
    throw new ApiError(
      "invalid_network_policy",
      "Host allowlist requires at least one host.",
      400,
    );
  if (!input.allowPrivateNetwork) {
    const blocked = allowedHosts.find(isPrivateNetworkHost);
    if (blocked)
      throw new ApiError(
        "private_network_host_blocked",
        "Connector network policy cannot target private hosts by default.",
        400,
        { host: blocked },
      );
  }
  return {
    mode: "allow_hosts",
    allowedHosts,
    allowPrivateNetwork: input.allowPrivateNetwork,
  };
}

function normalizeHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (
    !hostnamePattern.test(normalized) ||
    normalized.includes("..") ||
    normalized.startsWith(".") ||
    normalized.endsWith(".")
  ) {
    throw new ApiError(
      "invalid_network_policy_host",
      "Allowed hosts must be plain hostnames without protocol, port, or path.",
      400,
    );
  }
  return normalized;
}
