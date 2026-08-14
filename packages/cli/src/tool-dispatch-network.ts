import type { ToolOperationDispatchRequestClaimResult } from "./api-types";
import type { ToolDispatchPinnedFetch } from "./dns-pinned-fetch";
import {
  isBlockedNetworkAddress,
  isNetworkIpAddress,
  isPrivateNetworkHost,
  normalizeNetworkHost,
  normalizeResolvedNetworkAddress,
} from "./network-host-policy";
import type {
  RunToolDispatchWorkerInput,
  ToolDispatchDnsAddress,
  ToolDispatchPayload,
} from "./tool-dispatch-worker";

export async function assertResolvedHostAllowed(
  input: Pick<
    RunToolDispatchWorkerInput,
    "allowPrivateNetwork" | "dnsLookup" | "pinnedFetchImpl"
  >,
  host: string,
): Promise<ToolDispatchDnsAddress[]> {
  if (input.allowPrivateNetwork === true) return [];
  if (isNetworkIpAddress(host)) return [];
  if (input.dnsLookup === undefined) {
    if (input.pinnedFetchImpl !== undefined)
      throw new Error("worker_dns_lookup_failed");
    return [];
  }
  let addresses: ToolDispatchDnsAddress[];
  try {
    addresses = await input.dnsLookup(host);
  } catch {
    throw new Error("worker_dns_lookup_failed");
  }
  if (addresses.length === 0) throw new Error("worker_dns_lookup_failed");
  const normalizedAddresses = addresses.map((item) =>
    normalizeResolvedNetworkAddress(item.address, item.family),
  );
  if (normalizedAddresses.some((item) => item === undefined)) {
    throw new Error("worker_dns_lookup_failed");
  }
  const approvedAddresses = normalizedAddresses.filter(
    (item): item is NonNullable<typeof item> => item !== undefined,
  );
  if (approvedAddresses.some((item) => isBlockedNetworkAddress(item.address))) {
    throw new Error("worker_host_denied");
  }
  return approvedAddresses;
}

export function buildDispatchUrl(
  claim: ToolOperationDispatchRequestClaimResult,
  payload: ToolDispatchPayload,
  allowPrivateNetwork: boolean,
): URL {
  const host = claim.request?.host;
  if (host === undefined || !safeHost(host, allowPrivateNetwork)) {
    throw new Error("worker_host_denied");
  }
  const pathTemplate = claim.pathTemplate ?? "/";
  const parameters = payload.parameters ?? {};
  let renderedPath = pathTemplate;
  const usedPathParameters = new Set<string>();

  for (const parameterName of pathParameterNames(pathTemplate)) {
    const value = parameters[parameterName];
    if (value === undefined || value === null || String(value).length === 0) {
      throw new Error("worker_payload_invalid");
    }
    usedPathParameters.add(parameterName);
    renderedPath = renderedPath.replace(
      new RegExp(`\\{${escapeRegExp(parameterName)}\\}`, "gu"),
      encodeURIComponent(String(value)),
    );
  }

  const url = new URL(
    `https://${host}${renderedPath.startsWith("/") ? renderedPath : `/${renderedPath}`}`,
  );
  if (url.hostname !== host) throw new Error("worker_host_denied");
  for (const key of Object.keys(parameters).sort()) {
    if (usedPathParameters.has(key)) continue;
    const value = parameters[key];
    if (value !== undefined && value !== null)
      url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchWithTimeout(
  input: Pick<RunToolDispatchWorkerInput, "fetchImpl" | "pinnedFetchImpl">,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  approvedAddresses: ToolDispatchDnsAddress[],
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchApprovedHost(
      input,
      url,
      { ...init, signal: controller.signal },
      approvedAddresses,
    );
  } catch (error) {
    if (controller.signal.aborted) throw new Error("worker_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchApprovedHost(
  input: {
    fetchImpl: typeof fetch;
    pinnedFetchImpl?: ToolDispatchPinnedFetch;
  },
  url: URL,
  init: RequestInit,
  approvedAddresses: ToolDispatchDnsAddress[],
): Promise<Response> {
  if (approvedAddresses.length === 0) return await input.fetchImpl(url, init);
  if (input.pinnedFetchImpl === undefined) {
    throw new Error("worker_dns_pinning_unavailable");
  }
  return await input.pinnedFetchImpl(url, init, approvedAddresses);
}

export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ bodyBytes: number; bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null)
    return { bodyBytes: 0, bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  let bodyBytes = 0;
  let truncated = false;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > maxBytes) {
        const storedBytes = chunks.reduce(
          (total, chunk) => total + chunk.byteLength,
          0,
        );
        const remaining = Math.max(0, maxBytes - storedBytes);
        if (remaining > 0) chunks.push(next.value.slice(0, remaining));
        bodyBytes = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bodyBytes, bytes: concatBytes(chunks), truncated };
}

export function safeHost(host: string, allowPrivateNetwork: boolean): boolean {
  const normalized = normalizeNetworkHost(host);
  if (
    normalized.length === 0 ||
    normalized.includes("/") ||
    normalized.includes("@")
  )
    return false;
  return allowPrivateNetwork || !isPrivateNetworkHost(normalized);
}

function pathParameterNames(pathTemplate: string): string[] {
  const names: string[] = [];
  const matcher = /\{([^}]+)\}/gu;
  let match = matcher.exec(pathTemplate);
  while (match !== null) {
    if (match[1] !== undefined) names.push(match[1]);
    match = matcher.exec(pathTemplate);
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
