import { isIP } from "node:net";

import type { RomeoEnv } from "@romeo/config";
import type { Context } from "hono";

import { isAddressInNetworkCidrs } from "../services/network-host-policy";
import type { AppBindings } from "./context";

export interface TrustedProxyResolution {
  clientAddress?: string;
  peerAddress?: string;
  trusted: boolean;
}

/**
 * Resolves proxy metadata only after the transport peer and every declared
 * intermediate hop have matched the operator-controlled proxy CIDRs.
 */
export function resolveTrustedProxy(
  context: Context<AppBindings>,
  env: Pick<
    RomeoEnv,
    | "EDGE_TRUSTED_PROXY_CIDRS"
    | "EDGE_TRUSTED_PROXY_HOPS"
    | "EDGE_TRUSTED_PROXY_MODE"
  >,
): TrustedProxyResolution {
  const peerAddress = normalizePeerAddress(context.env?.requestPeerAddress);
  const base = peerAddress === undefined ? {} : { peerAddress };
  if (env.EDGE_TRUSTED_PROXY_MODE !== "trusted_proxy") {
    return { ...base, trusted: false };
  }
  const cidrs = env.EDGE_TRUSTED_PROXY_CIDRS.split(",").filter(Boolean);
  if (
    peerAddress === undefined ||
    !isAddressInNetworkCidrs(peerAddress, cidrs)
  ) {
    return { ...base, trusted: false };
  }
  const forwarded = parseForwardedAddressChain(
    context.req.header("x-forwarded-for"),
  );
  if (forwarded === undefined || forwarded.length < env.EDGE_TRUSTED_PROXY_HOPS)
    return { ...base, trusted: false };
  const clientIndex = forwarded.length - env.EDGE_TRUSTED_PROXY_HOPS;
  const intermediates = forwarded.slice(clientIndex + 1);
  if (
    intermediates.some((address) => !isAddressInNetworkCidrs(address, cidrs))
  ) {
    return { ...base, trusted: false };
  }
  return {
    ...base,
    clientAddress: forwarded[clientIndex]!,
    trusted: true,
  };
}

export function trustedForwardedProtocol(
  context: Context<AppBindings>,
  resolution: TrustedProxyResolution,
): "http" | "https" | undefined {
  if (!resolution.trusted) return undefined;
  const values = context.req
    .header("x-forwarded-proto")
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    values === undefined ||
    values.length === 0 ||
    values.some((value) => value !== "http" && value !== "https")
  ) {
    return undefined;
  }
  return values[0] as "http" | "https";
}

function parseForwardedAddressChain(
  value: string | undefined,
): string[] | undefined {
  if (value === undefined || value.length === 0 || value.length > 4_096)
    return undefined;
  const addresses = value.split(",").map((part) => normalizePeerAddress(part));
  if (
    addresses.length === 0 ||
    addresses.length > 20 ||
    addresses.some((address) => address === undefined)
  ) {
    return undefined;
  }
  return addresses as string[];
}

function normalizePeerAddress(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const unbracketed = trimmed.replace(/^\[(.*)\]$/u, "$1");
  const withoutZone = unbracketed.split("%")[0] ?? "";
  if (isIP(withoutZone) === 0) return undefined;
  if (withoutZone.startsWith("::ffff:")) {
    const mapped = withoutZone.slice("::ffff:".length);
    if (isIP(mapped) === 4) return mapped;
  }
  return withoutZone;
}
