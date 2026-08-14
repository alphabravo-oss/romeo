import { createS3PresignedRequest } from "./s3-signer";
import type {
  ObjectStore,
  PresignedUpload,
  PutObjectInput,
  StoredObject,
} from "./types";
import { ObjectSizeLimitError } from "./types";

export interface S3ObjectStoreConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region?: string;
  secretAccessKey: string;
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3ObjectStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const upload = await this.createPresignedUpload({
      key: input.key,
      contentType: input.contentType,
      expiresInSeconds: 900,
    });
    const response = await this.fetchImpl(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: toArrayBuffer(input.body),
    });
    if (!response.ok)
      throw new Error(`Object upload failed with ${response.status}.`);

    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      etag:
        normalizeEtag(response.headers.get("etag")) ??
        (await objectEtag(input.body)),
      updatedAt: new Date().toISOString(),
    };
  }

  async getObject(
    key: string,
    options: { maxBytes?: number } = {},
  ): Promise<Uint8Array | undefined> {
    const request = await this.presign({
      key,
      method: "GET",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, { method: "GET" });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Object read failed with ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      options.maxBytes !== undefined &&
      Number.isFinite(declaredLength) &&
      declaredLength > options.maxBytes
    ) {
      await response.body?.cancel();
      throw new ObjectSizeLimitError(options.maxBytes);
    }
    return readResponseBytes(response, options.maxBytes);
  }

  async headObject(key: string): Promise<StoredObject | undefined> {
    const request = await this.presign({
      key,
      method: "HEAD",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, { method: "HEAD" });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Object metadata read failed with ${response.status}.`);
    const sizeBytes = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
      throw new Error("Object metadata did not include a valid byte length.");
    return {
      key,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      sizeBytes,
      etag: normalizeEtag(response.headers.get("etag")) ?? "",
      updatedAt:
        response.headers.get("last-modified") ?? new Date().toISOString(),
    };
  }

  async deleteObject(key: string): Promise<void> {
    const request = await this.presign({
      key,
      method: "DELETE",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, { method: "DELETE" });
    if (!response.ok && response.status !== 404)
      throw new Error(`Object delete failed with ${response.status}.`);
  }

  async createPresignedUpload(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
    sha256?: string;
    sizeBytes?: number;
  }): Promise<PresignedUpload> {
    const request = await this.presign({
      key: input.key,
      method: "PUT",
      contentType: input.contentType,
      ...(input.sizeBytes === undefined
        ? {}
        : { contentLength: input.sizeBytes }),
      expiresInSeconds: input.expiresInSeconds,
    });
    return {
      key: input.key,
      url: request.url,
      method: "PUT",
      expiresAt: request.expiresAt,
      headers: request.headers,
    };
  }

  private presign(input: {
    contentLength?: number;
    contentType?: string;
    expiresInSeconds: number;
    key: string;
    method: "DELETE" | "GET" | "HEAD" | "PUT";
  }) {
    return createS3PresignedRequest({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      key: input.key,
      method: input.method,
      region: this.config.region ?? "us-east-1",
      secretAccessKey: this.config.secretAccessKey,
      expiresInSeconds: input.expiresInSeconds,
      ...(input.contentLength === undefined
        ? {}
        : { contentLength: input.contentLength }),
      ...(input.contentType !== undefined
        ? { contentType: input.contentType }
        : {}),
    });
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number | undefined,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (maxBytes !== undefined && total > maxBytes) {
        await reader.cancel();
        throw new ObjectSizeLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function objectEtag(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function normalizeEtag(value: string | null): string | undefined {
  return value?.replace(/^"|"$/g, "");
}
