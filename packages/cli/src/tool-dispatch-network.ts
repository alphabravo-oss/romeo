import type { ToolOperationDispatchRequestClaimResult } from "./api-types";
import type {
  RunToolDispatchWorkerInput,
  ToolDispatchDnsAddress,
  ToolDispatchPayload,
} from "./tool-dispatch-worker";

export async function assertResolvedHostAllowed(
  input: Pick<RunToolDispatchWorkerInput, "allowPrivateNetwork" | "dnsLookup">,
  host: string,
): Promise<void> {
  if (input.allowPrivateNetwork === true || input.dnsLookup === undefined)
    return;
  if (ipLiteral(host)) return;
  let addresses: ToolDispatchDnsAddress[];
  try {
    addresses = await input.dnsLookup(host);
  } catch {
    throw new Error("worker_dns_lookup_failed");
  }
  if (addresses.length === 0) throw new Error("worker_dns_lookup_failed");
  if (addresses.some((item) => privateAddress(item.address))) {
    throw new Error("worker_host_denied");
  }
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
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("worker_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  const normalized = host.toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.includes("/") ||
    normalized.includes("@")
  )
    return false;
  if (allowPrivateNetwork) return true;
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "kubernetes.default" ||
    normalized.endsWith(".svc") ||
    normalized.endsWith(".cluster.local") ||
    normalized === "metadata.google.internal"
  ) {
    return false;
  }
  return !privateIpv4(normalized) && !privateIpv6(normalized);
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return privateIpv4(normalized) || privateIpv6(normalized);
}

function ipLiteral(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return ipv4Octets(normalized) !== undefined || normalized.includes(":");
}

function privateIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (octets === undefined) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined;
  return octets;
}

function privateIpv6(host: string): boolean {
  const normalized = host.replace(/^\[/u, "").replace(/\]$/u, "");
  if (normalized.startsWith("::ffff:"))
    return privateIpv4(normalized.slice("::ffff:".length));
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff")
  );
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
