import { CliUsageError } from "./cli-errors";
import type { CommandContext } from "./commands";
import { readCliSecret } from "./secret-input";

export type WorkerBrokerAudience =
  | "browser_automation"
  | "knowledge_extraction"
  | "tool_dispatch";

export interface WorkerBrokerHttpClient {
  complete(input: {
    claimToken: string;
    errorCode?: string;
    response?: unknown;
    result?: unknown;
    success: boolean;
  }): Promise<unknown>;
  claim(input: {
    leaseSeconds: number;
    payloadStorage?:
      | "external_worker_secret_store_required"
      | "managed_encrypted_object_store";
  }): Promise<BrokerClaimEnvelope>;
  renew(input: {
    claimToken: string;
    leaseSeconds: number;
  }): Promise<BrokerClaimEnvelope>;
}

interface BrokerClaimEnvelope {
  claim?: unknown;
  claimed: boolean;
  claimToken?: string;
}

const audienceCredentialEnvironment: Record<WorkerBrokerAudience, string> = {
  browser_automation: "BROWSER_AUTOMATION_BROKER_TOKEN",
  knowledge_extraction: "KNOWLEDGE_EXTRACTION_BROKER_TOKEN",
  tool_dispatch: "TOOL_DISPATCH_BROKER_TOKEN",
};

export function workerBrokerHttpClient(
  context: Pick<CommandContext, "baseUrl" | "env" | "fetchImpl">,
  audience: WorkerBrokerAudience,
): WorkerBrokerHttpClient {
  const environment = context.env ?? process.env;
  const credentialEnvironment = audienceCredentialEnvironment[audience];
  const credential = readCliSecret(environment, credentialEnvironment);
  if (credential === undefined)
    throw new CliUsageError(
      `${credentialEnvironment} or ${credentialEnvironment}_FILE is required for the ${audience} worker.`,
    );
  if (context.baseUrl === undefined)
    throw new CliUsageError("ROMEO_BASE_URL is required for brokered workers.");
  const baseUrl = brokerBaseUrl(
    context.baseUrl,
    environment.ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP === "true",
  );
  const workerId =
    nonEmpty(environment.ROMEO_WORKER_ID) ??
    nonEmpty(environment.HOSTNAME) ??
    `${audience}-worker`;
  const endpoint = new URL(
    `/api/v1/internal/worker-broker/${audience}/claims`,
    baseUrl,
  );
  return {
    claim: (input) =>
      request(endpoint, credential, workerId, context.fetchImpl, input),
    renew: (input) =>
      request(
        new URL(`${endpoint.pathname}/renew`, endpoint),
        credential,
        workerId,
        context.fetchImpl,
        input,
      ),
    complete: (input) =>
      request(
        new URL(`${endpoint.pathname}/complete`, endpoint),
        credential,
        workerId,
        context.fetchImpl,
        input,
      ).then((response) => response.data),
  };
}

async function request<TBody extends object>(
  url: URL,
  credential: string,
  workerId: string,
  fetchImpl: typeof fetch,
  body: TBody,
): Promise<BrokerClaimEnvelope & { data?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 330_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...body, workerId }),
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await readBoundedBody(response, 10_000_000);
    const decoded = decodeJson(bytes);
    if (!response.ok) throw brokerHttpError(response.status, decoded);
    const data = envelopeData(decoded);
    if (typeof data !== "object" || data === null || Array.isArray(data))
      throw new Error("worker_broker_response_invalid");
    const record = data as Record<string, unknown>;
    if (typeof record.claimed === "boolean") {
      return {
        claimed: record.claimed,
        ...(record.claim === undefined ? {} : { claim: record.claim }),
        ...(typeof record.claimToken === "string"
          ? { claimToken: record.claimToken }
          : {}),
      };
    }
    return { claimed: false, data };
  } finally {
    clearTimeout(timeout);
  }
}

function envelopeData(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return (value as { data?: unknown }).data;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("worker_broker_response_invalid");
  }
}

function brokerHttpError(status: number, value: unknown): Error {
  void value;
  return new Error(`worker_broker_http_${status}`);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : value.trim();
}

function brokerBaseUrl(value: string, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliUsageError("ROMEO_BASE_URL must be a valid broker origin.");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new CliUsageError(
      "ROMEO_BASE_URL must be an origin without credentials, path, query, or fragment for brokered workers.",
    );
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (loopback || allowInsecureHttp))
  ) {
    throw new CliUsageError(
      "ROMEO_BASE_URL must use HTTPS for brokered workers; controlled in-cluster HTTP requires ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP=true.",
    );
  }
  return url;
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new Error("worker_broker_response_too_large");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("worker_broker_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
