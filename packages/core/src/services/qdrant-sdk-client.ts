import { QdrantClient } from "@qdrant/js-client-rest";
import { createHmac, randomBytes } from "node:crypto";

export type QdrantSdkClient = Pick<
  QdrantClient,
  "delete" | "getCollection" | "query" | "scroll" | "upsert"
>;

export interface QdrantSdkClientOptions {
  apiKey: string;
  timeoutMs: number;
  url: string;
}

export type QdrantSdkClientFactory = (
  options: QdrantSdkClientOptions,
) => QdrantSdkClient;

export interface QdrantSdkClientProvider {
  client(options: QdrantSdkClientOptions): QdrantSdkClient;
  close?(): void;
}

export const defaultQdrantSdkClientFactory: QdrantSdkClientFactory = (
  options,
) =>
  new QdrantClient({
    apiKey: options.apiKey,
    checkCompatibility: false,
    timeout: options.timeoutMs,
    url: options.url,
  });

/** Process-owned, bounded pool keyed by a non-reversible credential digest. */
export class BoundedQdrantSdkClientPool implements QdrantSdkClientProvider {
  private readonly clients = new Map<string, QdrantSdkClient>();
  private readonly cacheKey = randomBytes(32);
  private closed = false;

  constructor(
    private readonly factory: QdrantSdkClientFactory = defaultQdrantSdkClientFactory,
    private readonly maxClients = 128,
  ) {
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 1_024)
      throw new Error("qdrant_client_pool_size_invalid");
  }

  client(options: QdrantSdkClientOptions): QdrantSdkClient {
    if (this.closed) throw new Error("qdrant_client_pool_closed");
    const key = createHmac("sha256", this.cacheKey)
      .update(options.url)
      .update("\0")
      .update(String(options.timeoutMs))
      .update("\0")
      .update(options.apiKey)
      .digest("hex");
    const existing = this.clients.get(key);
    if (existing !== undefined) {
      this.clients.delete(key);
      this.clients.set(key, existing);
      return existing;
    }
    const client = this.factory(options);
    this.clients.set(key, client);
    const oldest = this.clients.keys().next().value as string | undefined;
    if (this.clients.size > this.maxClients && oldest !== undefined)
      this.clients.delete(oldest);
    return client;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clients.clear();
    this.cacheKey.fill(0);
  }
}
