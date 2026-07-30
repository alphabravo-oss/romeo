import {
  Decoder,
  GlideClient,
  Logger,
  type GlideReturnType,
} from "@valkey/valkey-glide";

// Romeo emits redacted coordination telemetry at the service boundary; avoid
// letting the native SDK print connection targets directly to process output.
Logger.init("off");

export type ValkeyValue = string | number | null | ValkeyValue[];

/**
 * Small Romeo boundary around the official Valkey GLIDE client.
 *
 * Callers retain the command-oriented interface used by the quota Lua scripts,
 * while GLIDE owns connection pooling, TLS, authentication, RESP framing,
 * reconnection, and request timeouts.
 */
export class ValkeyGlideClient {
  private clientPromise: Promise<GlideClient> | undefined;

  constructor(private readonly options: { timeoutMs: number; url: string }) {}

  async command(args: string[]): Promise<ValkeyValue> {
    const client = await this.client();
    const response = await client.customCommand(args, {
      decoder: Decoder.String,
    });
    return normalizeResponse(response);
  }

  close(): void {
    const clientPromise = this.clientPromise;
    this.clientPromise = undefined;
    if (clientPromise === undefined) return;
    void clientPromise.then((client) => client.close()).catch(() => undefined);
  }

  private client(): Promise<GlideClient> {
    if (this.clientPromise !== undefined) return this.clientPromise;
    const configuration = valkeyGlideConfiguration(this.options);
    const pending = GlideClient.createClient(configuration);
    this.clientPromise = pending;
    void pending.catch(() => {
      if (this.clientPromise === pending) this.clientPromise = undefined;
    });
    return pending;
  }
}

export function valkeyGlideConfiguration(options: {
  timeoutMs: number;
  url: string;
}) {
  const url = new URL(options.url);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("valkey_url_protocol_invalid");
  }
  const port = url.port === "" ? 6379 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("valkey_url_port_invalid");
  }
  const databaseId = parseDatabaseIndex(url.pathname);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return {
    addresses: [{ host: url.hostname, port }],
    requestTimeout: options.timeoutMs,
    useTLS: url.protocol === "rediss:",
    ...(databaseId === undefined ? {} : { databaseId }),
    ...(username === "" && password === ""
      ? {}
      : {
          credentials: {
            ...(username === "" ? {} : { username }),
            password,
          },
        }),
  };
}

function parseDatabaseIndex(pathname: string): number | undefined {
  const normalized = pathname.replace(/^\/+/, "").trim();
  if (normalized === "") return undefined;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("valkey_database_index_invalid");
  }
  return parsed;
}

function normalizeResponse(value: GlideReturnType): ValkeyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") return Number(value);
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (Array.isArray(value)) return value.map(normalizeResponse);
  throw new Error("valkey_response_invalid");
}
